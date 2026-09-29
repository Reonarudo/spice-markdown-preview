import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetlist, MAX_PARTS, type Netlist, type Part } from '../src/netlist';

function parts(source: string): Part[] {
  return netlist(source).parts;
}

function netlist(source: string): Netlist {
  const result = parseNetlist(source);
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function error(source: string) {
  const result = parseNetlist(source);
  if (result.ok) assert.fail('expected an error');
  return result;
}

test('two-terminal passives map their nodes to pins A and B and keep the rest as the value', () => {
  assert.deepEqual(parts('R1 in out 10k\nC1 out 0 100n\nL1 a b 1m IC=0'), [
    { ref: 'R1', kind: 'resistor', pins: [{ name: 'A', node: 'in' }, { name: 'B', node: 'out' }], value: '10k', line: 1 },
    { ref: 'C1', kind: 'capacitor', pins: [{ name: 'A', node: 'out' }, { name: 'B', node: '0' }], value: '100n', line: 2 },
    { ref: 'L1', kind: 'inductor', pins: [{ name: 'A', node: 'a' }, { name: 'B', node: 'b' }], value: '1m IC=0', line: 3 }
  ]);
});

test('sources keep their whole specification, parentheses included, and may omit it', () => {
  const [v, i, bare] = parts('V1 in 0 SIN(0 1 1k)\nI1 0 x DC 1m\nV2 a b');
  assert.deepEqual(v, { ref: 'V1', kind: 'vsource', pins: [{ name: '+', node: 'in' }, { name: '-', node: '0' }], value: 'SIN(0 1 1k)', line: 1 });
  assert.equal(i!.kind, 'isource');
  assert.equal(i!.value, 'DC 1m');
  assert.equal(bare!.value, '');
});

test('every spelling of ground is node 0, and node names are case-insensitive', () => {
  const [a, b] = parts('R1 GND Out 1\nR2 gnd OUT 1');
  assert.deepEqual(a!.pins.map((pin) => pin.node), ['0', 'out']);
  assert.deepEqual(b!.pins.map((pin) => pin.node), ['0', 'out']);
});

test('a diode maps anode and cathode to + and -, with its model as the value', () => {
  assert.deepEqual(parts('D1 a k 1N4148')[0], {
    ref: 'D1', kind: 'diode', pins: [{ name: '+', node: 'a' }, { name: '-', node: 'k' }], value: '1N4148', line: 1
  });
});

test('a bipolar transistor is NPN or PNP by its .model, defined anywhere in the fence', () => {
  const { parts: [npn, pnp], notes } = netlist('Q1 c b e BC547\nQ2 c b e BC557\n.model BC547 NPN(BF=300)\n.model BC557 PNP');
  assert.deepEqual(npn, { ref: 'Q1', kind: 'npn', pins: [{ name: 'C', node: 'c' }, { name: 'B', node: 'b' }, { name: 'E', node: 'e' }], value: 'BC547', line: 1 });
  assert.equal(pnp!.kind, 'pnp');
  assert.deepEqual(notes, []);
});

test('an undefined transistor model is drawn as NPN, and that is noted', () => {
  const { parts: [q], notes } = netlist('Q1 c b e 2N3906');
  assert.equal(q!.kind, 'npn');
  assert.deepEqual(notes, ['Line 1: model 2N3906 of Q1 is not defined here; drawn as NPN.']);
});

test('a bipolar transistor may name a substrate node, which is noted and not drawn', () => {
  const { parts: [withArea, withSubstrate], notes } = netlist('Q1 c b e BC547 2\nQ2 c b e sub BC547\n.model BC547 NPN');
  assert.equal(withArea!.value, 'BC547 2');
  assert.equal(withArea!.pins.length, 3);
  assert.equal(withSubstrate!.value, 'BC547');
  assert.deepEqual(notes, ['Line 2: the substrate connection of Q2 is not drawn.']);
});

test('a MOSFET has four pins and is NMOS or PMOS by its .model', () => {
  const [n, p] = parts('M1 d g s b nch W=1u L=100n\nM2 d g s b pch\n.model nch NMOS\n.model pch PMOS level=1');
  assert.deepEqual(n, {
    ref: 'M1', kind: 'nmos',
    pins: [{ name: 'D', node: 'd' }, { name: 'G', node: 'g' }, { name: 'S', node: 's' }, { name: 'B', node: 'b' }],
    value: 'nch W=1u L=100n', line: 1
  });
  assert.equal(p!.kind, 'pmos');
});

test('a subcircuit instance is a block with its ports named from .subckt, whose body is skipped', () => {
  const { parts: found } = netlist([
    'X1 in out 0 filter R=1k',
    '.subckt filter a b gnd params: R=1',
    'R1 a b {R}',
    'C1 b gnd 1n',
    '.ends',
    'R9 out 0 1k'
  ].join('\n'));
  assert.deepEqual(found.map((part) => part.ref), ['X1', 'R9']);
  assert.deepEqual(found[0], {
    ref: 'X1', kind: 'block', title: 'filter',
    pins: [{ name: 'a', node: 'in' }, { name: 'b', node: 'out' }, { name: 'gnd', node: '0' }],
    value: 'R=1k', line: 1
  });
});

test('an undefined subcircuit numbers its pins, and that is noted', () => {
  const { parts: [x], notes } = netlist('X1 a b opamp');
  assert.deepEqual(x!.pins, [{ name: '1', node: 'a' }, { name: '2', node: 'b' }]);
  assert.match(notes[0]!, /subcircuit opamp of X1 is not defined here/);
});

test('an instance with the wrong number of nodes for its subcircuit is an error', () => {
  const result = error('X1 a b amp\n.subckt amp in out vcc\n.ends');
  assert.equal(result.message, 'X1 connects 2 nodes, but subcircuit amp has 3 ports.');
  assert.deepEqual([result.line, result.column], [1, 7]);
});

test('dependent sources, JFETs and switches are titled blocks with named pins', () => {
  const [e, f, j, s] = parts('E1 o 0 a b 10\nF1 o 0 Vsense 2\nJ1 d g s J2N\nS1 a b c d sw');
  assert.equal(e!.title, 'VCVS');
  assert.deepEqual(e!.pins.map((pin) => pin.name), ['n+', 'n-', 'nc+', 'nc-']);
  assert.equal(f!.value, 'Vsense 2');
  assert.deepEqual(j!.pins.map((pin) => pin.name), ['D', 'G', 'S']);
  assert.equal(s!.title, 'switch');
});

test('continuation lines, comments and inline comments are handled as in ngspice', () => {
  const found = parts([
    '* a comment',
    'R1 in',
    '+ out 10k ; the load',
    'C1 out 0 1n $ bypass',
    'V1 in 0 DC 5 // supply',
    '  * an indented comment'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.pins.map((pin) => pin.node).join(' '), part.value, part.line]), [
    ['R1', 'in out', '10k', 2],
    ['C1', 'out 0', '1n', 4],
    ['V1', 'in 0', 'DC 5', 5]
  ]);
});

test('analysis directives, .control blocks and .end are skipped; nothing after .end is read', () => {
  const { parts: found, notes } = netlist([
    'R1 a 0 1k',
    '.tran 1u 1m',
    '.control',
    'run',
    'plot v(a)',
    '.endc',
    '.include models.lib',
    '.end',
    'this is not a netlist'
  ].join('\n'));
  assert.deepEqual(found.map((part) => part.ref), ['R1']);
  assert.deepEqual(notes, ['Line 7: .include models.lib is not read: no files are available here.']);
});

test('coupling is noted, not drawn', () => {
  const { parts: found, notes } = netlist('L1 a 0 1m\nL2 b 0 1m\nK1 L1 L2 0.99');
  assert.equal(found.length, 2);
  assert.deepEqual(notes, ['Line 3: coupling K1 (L1 L2 0.99) is not drawn.']);
});

test('W = 1u with spaces is one parameter, as ngspice reads it', () => {
  assert.equal(parts('M1 d g s b nch W = 1u L=1u\n.model nch nmos')[0]!.value, 'nch W=1u L=1u');
});

test('a title line gets a hint, and errors name the line and column', () => {
  const title = error('Common emitter amplifier\nR1 a b 1k');
  assert.equal(title.message, 'Common needs a value after its nodes. If this line is a title, start it with * to make it a comment.');
  assert.deepEqual([title.line, title.column], [1, 25]);
  const missing = error('R1 a b 1k\nD1 a');
  assert.equal(missing.message, 'D1 needs 2 nodes; found 1.');
  assert.deepEqual([missing.line, missing.column], [2, 5]);
});

test('unsupported element letters, bad names, duplicates and stray continuations are errors', () => {
  assert.equal(error('R1 a b 1\nU1 a b c').message, 'Element type U (U1) is not supported.');
  assert.match(error('1R a b 1k').message, /is not an element name/);
  const duplicate = error('R1 a b 1\nr1 c d 2');
  assert.equal(duplicate.message, 'Duplicate element r1; it is also defined on line 1.');
  assert.equal(duplicate.line, 2);
  assert.equal(error('+ R1 a b 1').message, 'A continuation line (+) has nothing to continue.');
  assert.equal(error('.subckt amp a b\nR1 a b 1').message, '.subckt has no matching .ends.');
});

test('an empty netlist, or one of only directives, is an error', () => {
  assert.match(error('').message, /^No elements found/);
  assert.match(error('* just a comment\n.tran 1u 1m').message, /^No elements found/);
});

test('more parts than the limit is an error pointing at the first one over it', () => {
  const lines = Array.from({ length: MAX_PARTS + 1 }, (_, i) => `R${i} n${i} n${i + 1} 1k`);
  const result = error(lines.join('\n'));
  assert.equal(result.line, MAX_PARTS + 1);
  assert.match(result.message, /split the circuit/);
});

test('never throws, whatever the input', () => {
  const inputs = ['', '\n\n', '+', '.', 'R', 'R1', 'X1', 'Q1 a b', 'M1 a b c', '((((', 'R1 a b (', '.subckt', '.model',
    'V1 a b SIN(', '\u0000', 'R1 a b ' + '('.repeat(1000), 'X' + ' a'.repeat(1000)];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseNetlist(input), JSON.stringify(input));
  }
});
