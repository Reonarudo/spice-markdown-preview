/**
 * What the reader makes of ngspice netlists now that it reads them through the generated ngspice
 * parser: one case per place where the old reader differed from ngspice-47 (the ngspice research,
 * Redmine #1184), as resolved by the dialect decisions (no title line, ADR 0006; the first `.end`
 * ends the netlist, #1195). `test/netlist.test.ts` keeps the behaviour that did not change.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseNetlist, type Netlist, type Part } from '../src/netlist';
import { loadNgspice } from './helpers/ngspice';

before(loadNgspice);

function netlist(source: string): Netlist {
  const result = parseNetlist(source);
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function parts(source: string): Part[] {
  return netlist(source).parts;
}

function error(source: string) {
  const result = parseNetlist(source);
  if (result.ok) assert.fail('expected an error');
  return result;
}

/** A part's pins as `name=node` strings. */
function pins(part: Part | undefined): string[] {
  return (part?.pins ?? []).map((pin) => `${pin.name}=${pin.node}`);
}

// 1. The first line is an element, not a title (ADR 0006), and the hint stays for a line that fails there.
test('line 1 is read as an element; a title-like first line gets the hint', () => {
  assert.equal(parts('R1 in out 10k')[0]!.ref, 'R1');
  const title = error('My amplifier\nR1 a b 1k');
  assert.equal(title.message, 'My needs 3 nodes; found 1. If this line is a title, start it with * to make it a comment.');
  const number = error('2N2222 test circuit\nR1 a b 1k');
  assert.equal(number.message, '"2N2222" is not an element name. Element names start with a letter, e.g. R1. If this line is a title, start it with * to make it a comment.');
  assert.deepEqual([number.line, number.column], [1, 0]);
});

// 2. The first `.end` ends the netlist (#1195); what follows is counted in a note.
test('the first .end ends the netlist, and the lines after it are noted', () => {
  const { parts: found, notes } = netlist('R1 a 0 1k\n.end\nR2 a 0 1k\n* comment\nR3 a 0 1k');
  assert.deepEqual(found.map((part) => part.ref), ['R1']);
  assert.deepEqual(notes, ['Line 2: 2 lines after .end are not read.']);
  assert.deepEqual(netlist('R1 a 0 1k\n.end\n\n').notes, []);
});

// 3. `#` and lines starting with a special character are comments.
test('# lines and lines starting with = [ ] ? ( ) & % $ " ! : , are comments', () => {
  const found = parts('# a hash comment\n= not a card\n(a b) c\n$ dollar\nR1 a b 1k\n, comma');
  assert.deepEqual(found.map((part) => part.ref), ['R1']);
});

// 4. `//` anywhere, `$` after a comma, and nothing inside quotes is a comment.
test('// needs no blank before it, $ comments after a comma, and comment characters inside quotes are kept', () => {
  const [glued, comma, quoted] = parts("R1 a b 3k//x\nR2 a b 2k,$ note\nR3 a 0 r='V(a) ; $ // < 1 ? 1 : 2'");
  assert.equal(glued!.value, '3k');
  assert.equal(comma!.value, '2k');
  assert.equal(quoted!.value, "r='V(a) ; $ // < 1 ? 1 : 2'");
});

// 5. A trailing `\\` continues the line.
test('a line ending in \\\\ continues on the next line', () => {
  assert.deepEqual(parts('R1 a b \\\\\n1k\nR2 a b 2k').map((part) => [part.ref, part.value]), [['R1', '1k'], ['R2', '2k']]);
});

// 6. Quoted expressions keep their spaces as one value.
test("'…' expressions with spaces stay one token of the value", () => {
  const [c, v] = parts("C1 a 0 c='1n * 2'\nV1 1 0 '2 - 3'");
  assert.equal(c!.value, "c='1n * 2'");
  assert.deepEqual(pins(c), ['A=a', 'B=0']);
  assert.equal(v!.value, "'2 - 3'");
});

// 7. Parenthesised node lists on X and .subckt, and XSPICE's %vd(a b), read as nodes.
test('X1 (a b) sub and .subckt s (a b) connect their nodes; %vd(a b) is one differential port', () => {
  const found = parts('X1 (in out) filter\n.subckt filter (a b)\nR1 a b 1k\n.ends\nX2 ( in , out ) filter params: k=3\nA1 %vd(in 0) %id(out 0) g1');
  assert.deepEqual(pins(found[0]), ['a=in', 'b=out']);
  assert.equal(found[0]!.title, 'filter');
  assert.equal(found[1]!.value, 'params: k=3');
  assert.deepEqual(pins(found[2]), ['1+=in', '1-=0', '2+=out', '2-=0']);
});

// 8. E and G have more than one shape.
test('E and G take 2 nodes with vol=, cur=, value= and TABLE, 2n+2 with POLY(n) and and(n), and 4 after the VCVS keyword', () => {
  const found = parts([
    'E1 1 0 POLY(2) a 0 b 0 0 1 1',
    'E2 1 0 value={V(a)*2}',
    "G1 1 0 cur='V(a)'",
    "E3 1 0 vol='V(a)'",
    'E4 1 0 TABLE {V(a)} = (0 0) (1 1)',
    'E5 1 0 vcvs a 0 2',
    'E6 1 0 and(2) a 0 b 0 (0.5, 4.5)',
    'E7 1 0 a 0 2',
    'G2 1 0 a 0 1m'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, pins(part).join(' '), part.value]), [
    ['E1', 'n+=1 n-=0 nc1+=a nc1-=0 nc2+=b nc2-=0', 'POLY(2) 0 1 1'],
    ['E2', 'n+=1 n-=0', 'value={V(a)*2}'],
    ['G1', 'n+=1 n-=0', "cur='V(a)'"],
    ['E3', 'n+=1 n-=0', "vol='V(a)'"],
    ['E4', 'n+=1 n-=0', 'TABLE {V(a)}=(0 0) (1 1)'],
    ['E5', 'n+=1 n-=0 nc+=a nc-=0', 'vcvs 2'],
    ['E6', 'n+=1 n-=0 nc1+=a nc1-=0 nc2+=b nc2-=0', 'and(2) (0.5, 4.5)'],
    ['E7', 'n+=1 n-=0 nc+=a nc-=0', '2'],
    ['G2', 'n+=1 n-=0 nc+=a nc-=0', '1m']
  ]);
  assert.equal(found[0]!.title, 'VCVS');
  assert.equal(found[2]!.title, 'VCCS');
});

// 9. M has 3 to 7 nodes, decided by the model, and P-type comes from the model too.
test('a VDMOS has three pins and is P-channel by pchan or vdmosp; an SOI MOSFET takes up to seven nodes', () => {
  const { parts: found, notes } = netlist([
    'M1 d g s PWR',
    'M2 d g s PPWR',
    'M3 d g s PWRP',
    'M4 d g s tj tc PWR thermal',
    'M5 d g s b p body t SOIP',
    'M6 d g s b nch',
    '.model PWR VDMOS(Rg=3)',
    '.model PPWR VDMOS pchan',
    '.model PWRP VDMOSP',
    '.model SOIP PSOI level=58',
    '.model nch NMOS'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.type, part.kind, pins(part).join(' ')]), [
    ['M1', 'vdmos', 'nmos', 'D=d G=g S=s'],
    ['M2', 'vdmos', 'pmos', 'D=d G=g S=s'],
    ['M3', 'vdmos', 'pmos', 'D=d G=g S=s'],
    ['M4', 'vdmos', 'nmos', 'D=d G=g S=s tj=tj tc=tc'],
    ['M5', 'soi-mosfet', 'pmos', 'D=d G=g S=s B=b P=p body=body T=t'],
    ['M6', 'mosfet', 'nmos', 'D=d G=g S=s B=b']
  ]);
  assert.equal(found[3]!.value, 'PWR thermal');
  assert.deepEqual(notes, [
    'Line 4: the thermal connection of M4 is not drawn.',
    'Line 4: the thermal connection of M4 is not drawn.',
    'Line 5: the body contact connection of M5 is not drawn.',
    'Line 5: the body connection of M5 is not drawn.',
    'Line 5: the thermal connection of M5 is not drawn.'
  ]);
});

// 10. Q has 3 to 5 nodes: the first token naming a defined model ends them.
test('a bipolar transistor with substrate and thermal nodes keeps its model', () => {
  const { parts: found, notes } = netlist('Q1 c b e s tj QV\nQ2 c b 0 QN 2\n.model QV NPN level=4\n.model QN PNP');
  assert.deepEqual(pins(found[0]), ['C=c', 'B=b', 'E=e', 'S=s', 'tj=tj']);
  assert.equal(found[0]!.value, 'QV');
  assert.equal(found[0]!.kind, 'npn');
  assert.deepEqual([found[1]!.kind, found[1]!.value], ['pnp', 'QN 2']);
  assert.deepEqual(notes, ['Line 1: the substrate connection of Q1 is not drawn.', 'Line 1: the thermal connection of Q1 is not drawn.']);
});

// 11. D may name a thermal node.
test('a diode with a thermal node has three nodes, and the model stays the value', () => {
  const { parts: found, notes } = netlist('D1 a k tj DTH thermal\n.model DTH D(rth0=10)');
  assert.deepEqual(pins(found[0]), ['+=a', '-=k', 'tj=tj']);
  assert.equal(found[0]!.value, 'DTH thermal');
  assert.deepEqual(notes, ['Line 1: the thermal connection of D1 is not drawn.']);
});

// 12. A, N, P, U and Y are ngspice elements.
test('A, N, P, U and Y are read: code models, Verilog-A devices, coupled lines, RC lines and TXL lines', () => {
  const { parts: found, notes } = netlist([
    'a1 %v[in in2] out sum1',
    'a2 [~d1 d2] d3 nand1',
    'a3 %vd in 0 null %d(dout) adc1',
    'N1 c b e hicum0 area=1',
    'P1 in1 in2 0 out1 out2 0 pmod len=1',
    'U1 a b 0 urcm l=1u n=4',
    'Y1 a 0 y1 0 ymod len=1',
    '.model sum1 summer(in_gain=[1 1])',
    '.model nand1 d_nand',
    '.model adc1 adc_bridge',
    '.model hicum0 hicuml0 type=1',
    '.model pmod cpl r=1 l=1 c=1',
    '.model urcm urc',
    '.model ymod txl r=1 l=1 c=1'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.type, part.title, pins(part).join(' ')]), [
    ['a1', 'xspice-model', 'summer', '1[0]=in 1[1]=in2 2=out'],
    ['a2', 'xspice-model', 'd_nand', '~1[0]=d1 1[1]=d2 2=d3'],
    ['a3', 'xspice-model', 'adc_bridge', '1+=in 1-=0 3=dout'],
    ['N1', 'osdi-device', 'hicuml0', '1=c 2=b 3=e'],
    ['P1', 'cpl-line', 'coupled line', 'in1=in1 in2=in2 refin=0 out1=out1 out2=out2 refout=0'],
    ['U1', 'urc-line', 'RC line', 'n1=a n2=b common=0'],
    ['Y1', 'txl-line', 'lossy line', 'in=a refin=0 out=y1 refout=0']
  ]);
  assert.deepEqual([found[0]!.value, found[3]!.value, found[4]!.value], ['sum1', 'hicum0 area=1', 'pmod len=1']);
  assert.deepEqual(notes, []);
  assert.equal(netlist('a1 in out undefined_model').notes[0], 'Line 1: model undefined_model of a1 is not defined here; its type is unknown.');
  assert.match(error('P1 a b c pmod').message, /P1 connects 3 nodes, which is not a whole number of coupled line ports/);
});

// 13. .subckt nests, and .macro/.eom are synonyms.
test('a nested .subckt is closed by its own .ends, and .macro … .eom defines a subcircuit', () => {
  const { parts: found } = netlist([
    'X1 a b outer',
    '.subckt outer p q',
    '.subckt inner r s',
    'R1 r s 1',
    '.ends inner',
    'X2 p q inner',
    '.ends outer',
    '.macro m x y',
    'R2 x y 1',
    '.eom',
    'X3 a b m'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, pins(part).join(' ')]), [['X1', 'p=a q=b'], ['X3', 'x=a y=b']]);
  assert.equal(error('.subckt a 1\n.subckt b 2\n.ends\nR1 1 2 1').message, '.subckt has no matching .ends.');
});

// 14. Any directive starting with .inc includes a file.
test('.incl and .include alike include a file', () => {
  const result = parseNetlist('.incl models.lib\nQ1 c b e Q', { files: { 'models.lib': '.model Q PNP' } });
  assert.ok(result.ok);
  assert.equal(result.netlist.parts[0]!.kind, 'pnp');
});

// 15. A one-argument .lib is an error in ngspice (see also test/includes.test.ts).
test('.lib without a section is an error that says what to write', () => {
  const result = parseNetlist('.lib models.lib\nR1 a 0 1', { files: { 'models.lib': '' } });
  assert.ok(!result.ok);
  assert.match(result.message, /^\.lib models\.lib needs a section name/);
});

// 16. .if branches are not evaluated: the first is drawn, the rest skipped.
test('.if draws its first branch and skips .elseif and .else, so the manual\'s example is no duplicate', () => {
  const { parts: found, notes } = netlist([
    '.param ok=1',
    '.if (ok == 1)',
    'R11 1 0 1',
    '.if (ok == 2)',
    'R12 1 0 2',
    '.else',
    'R13 1 0 3',
    '.endif',
    '.elseif (ok == 2)',
    'R11 1 0 10',
    '.else',
    'R11 1 0 100',
    '.endif',
    'V1 1 0 1'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.value]), [['R11', '1'], ['R12', '2'], ['V1', '1']]);
  assert.deepEqual(notes, [
    'Line 4: .if is not evaluated; its first branch is drawn and the .else branches are skipped.',
    'Line 2: .if is not evaluated; its first branch is drawn and the .elseif branches are skipped.'
  ]);
  assert.equal(error('.if (x)\nR1 a 0 1').message, '.if has no matching .endif.');
  assert.equal(error('R1 a 0 1\n.endif').message, '.endif has no matching .if.');
});

// Structural errors the parser reports get today's wording, and a new one for an open bracket.
test('an unterminated bracket and a stray = are reported where they are, in words', () => {
  const open = error('R1 a b 1\nV1 a 0 pulse(0 1 0 1n\nR2 a b 2');
  assert.equal(open.message, 'The ( opened here is not closed on its line.');
  assert.deepEqual([open.line, open.column], [2, 12]);
  const stray = error('R2 a b 1\nR1 a b =');
  assert.equal(stray.message, 'Unexpected end of line; expected word, keyword or group.');
  assert.deepEqual([stray.line, stray.column], [2, 7]);
  assert.match(error('R1 a b =').message, /^Unexpected end of line; expected word, keyword or group\. If this line is a title/);
  assert.equal(error('.control\nrun').message, '.control has no matching .endc.');
});

// A .model's level reaches the catalogue's selectors, and its type survives parentheses and continuation.
test('.model type and level are read whether bare, parenthesised or continued', () => {
  const [q] = parts('Q1 c b e N1\n.MODEL N1 PNP LEVEL=4\n+ IS=1e-16');
  assert.equal(q!.kind, 'pnp');
  const [m] = parts('M1 d g s b m1 L=1u\n.model m1 pmos ( level = 49 tox=1n )');
  assert.equal(m!.kind, 'pmos');
});

// --- Real decks ----------------------------------------------------------------------------------------

const CORPUS = join(import.meta.dirname, 'fixtures/ngspice/corpus');

/** Parts drawn and notes made when each deck was added, or the error it must give; a change here is a change in what is read. */
const EXPECTED: Record<string, [parts: number, notes: number] | { error: RegExp }> = {
  'examples/TransmissionLines/URC-TM-SUB.cir': [2, 0],
  'examples/TransmissionLines/cpl1_4_line.sp': [27, 0],
  'examples/cider/bjt/astable.cir': [10, 0],
  'examples/control_structs/if-test-1.cir': [2, 0],
  'examples/digital/compare/adder_Xspice.cir': [12, 0],
  'examples/digital/compare/adder_mos.cir': [10, 0],
  'examples/digital/digital_devices/counter.cir': [8, 0],
  // A control script only: nothing to draw.
  'examples/loops/loop_IfThenElse.cir': { error: /^No elements found/ },
  'examples/measure/simple-meas-tran.sp': [3, 0],
  'examples/mos/nmos_pmos_BSIM330.sp': [10, 0],
  // VBIC transistors with substrate nodes, one note each.
  'examples/osdi/hicuml0/DFF_Y_ECL_VBIC.sp': [26, 14],
  // Two includes nobody supplied, and the two models they would have defined.
  'tests/bsim3soipd/inv2.cir': [6, 4],
  'tests/general/mosmem.cir': [16, 0],
  'tests/general/schmitt.cir': [15, 0],
  'tests/polezero/filt_rc.cir': [3, 0],
  'tests/regression/lib-processing/ex1a.cir': [3, 1],
  'tests/regression/misc/bugs-2.cir': [1, 0],
  'tests/regression/misc/dollar-1.cir': [1, 0],
  // The first branch of the outer `.if`; the nested `.if` sits in a skipped branch and is not noted.
  'tests/regression/misc/if-elseif.cir': [2, 1],
  'tests/regression/parser/minus-minus.cir': [2, 0],
  'tests/transmission/txl1_1_line.cir': [7, 0],
  'tests/vbic/CEamp.cir': [7, 1],
  'tests/xspice/digital/d_source.cir': [2, 0]
};

function decks(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return decks(path);
    return /\.(cir|sp)$/.test(entry.name) ? [path] : [];
  });
}

test('every deck in the ngspice corpus is read, with the parts and notes it was added with', () => {
  const found = decks(CORPUS).map((path) => relative(CORPUS, path).split(sep).join('/')).sort();
  assert.deepEqual(found, Object.keys(EXPECTED).sort());
  for (const name of found) {
    // The first line of a SPICE deck is its title; a fence has none (ADR 0006).
    const text = readFileSync(join(CORPUS, name), 'utf8').replace(/^[^\n]*\n/, '');
    const result = parseNetlist(text);
    const expected = EXPECTED[name]!;
    if ('error' in expected) {
      assert.ok(!result.ok, `${name}: expected an error`);
      assert.match(result.message, expected.error, name);
      continue;
    }
    assert.ok(result.ok, `${name}: ${result.ok ? '' : result.message}`);
    assert.deepEqual([result.netlist.parts.length, result.netlist.notes.length], expected, `${name}: ${result.netlist.notes.join(' | ')}`);
  }
});
