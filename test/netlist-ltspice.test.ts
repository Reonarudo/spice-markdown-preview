/**
 * What the reader makes of LTspice netlists read through the generated LTspice parser: one case
 * per finding of the LTspice research (Redmine #1185) that changes what is drawn, resolved by the
 * catalogue (#1192, #1197) and the dialect decisions (no title line, ADR 0006; the first `.end`
 * ends the netlist, #1195). `test/parser-ltspice.test.ts` says how the lines are cut into tokens.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { includeReferences, parseNetlist, type IncludeSet, type Netlist, type Part } from '../src/netlist';
import { loadLtspice } from './helpers/ltspice';

before(loadLtspice);

function netlist(source: string, files: IncludeSet['files'] = {}): Netlist {
  const result = parseNetlist(source, { files }, 'ltspice');
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function parts(source: string, files?: IncludeSet['files']): Part[] {
  return netlist(source, files).parts;
}

function error(source: string, files: IncludeSet['files'] = {}) {
  const result = parseNetlist(source, { files }, 'ltspice');
  if (result.ok) assert.fail('expected an error');
  return result;
}

/** A part's pins as `name=node` strings. */
function pins(part: Part | undefined): string[] {
  return (part?.pins ?? []).map((pin) => `${pin.name}=${pin.node}`);
}

// 1. `$` is not a comment: `$G_…` global nodes survive, and `$` text after a blank is part of the value.
test('$G_ nodes are kept as nodes, and a $ after a blank is not a comment', () => {
  const [r, c] = parts('R1 $G_VDD out 1k $ note\nC1 out $G_VSS 1n');
  assert.deepEqual(pins(r), ['A=$g_vdd', 'B=out']);
  assert.equal(r!.value, '1k $ note');
  assert.deepEqual(pins(c), ['A=out', 'B=$g_vss']);
});

// 2. `//` is text; a line starting with `//` is not an element.
test('// is not a comment in LTspice', () => {
  assert.equal(parts('R1 a b 3k//x')[0]!.value, '3k//x');
  assert.match(error('R1 a b 1k\n// comment').message, /"\/\/" is not an element name/);
});

// 3. Only a line-initial `+` continues; `\\` does not.
test('a trailing \\\\ is a value, not a continuation', () => {
  assert.equal(parts('R1 a b \\\\\n* next')[0]!.value, '\\\\');
});

// 4. `@` and `&` are LTspice elements, drawn as blocks (#1197).
test('@ is a two-node FRA block and & a four-node FRA probe block', () => {
  const [fra, probe] = parts('@1 in out fstart=1 fend=1Meg\n&1 o+ o- i+ i-');
  assert.deepEqual([fra!.type, fra!.kind, fra!.title, pins(fra), fra!.value], ['fra', 'block', 'FRA', ['in=in', 'out=out'], 'fstart=1 fend=1Meg']);
  assert.deepEqual([probe!.type, probe!.title, pins(probe)], ['fra-probe', 'FRA probe', ['o+=o+', 'o-=o-', 'i+=i+', 'i-=i-']]);
});

// 5. `A` always has eight terminals and a keyword model; `U` is a three-node RC line.
test('A takes eight nodes and is titled by its function keyword; U is an RC line', () => {
  const [a, u] = parts('A1 in1 in2 0 0 0 0 out 0 AND\nU1 a b 0 urcmod L=1m\n.model urcmod URC');
  assert.deepEqual([a!.type, a!.title, pins(a).join(' '), a!.value], ['ltspice-function', 'AND', '1=in1 2=in2 3=0 4=0 5=0 6=0 7=out 8=0', 'AND']);
  assert.deepEqual([u!.type, pins(u).join(' ')], ['urc-line', 'n1=a n2=b common=0']);
});

// 6. `M` with a VDMOS model has three nodes, P-channel by `pchan` inside the model's parentheses.
test('a VDMOS M has three pins and is P-channel when its model says pchan', () => {
  const [n, p, bulk] = parts('M1 d g s IRF540\nM2 d g s IRF9540\nM3 d g s b NCH\n.model IRF540 VDMOS(Rg=3 Vto=4)\n.model IRF9540 VDMOS(pchan Vto=-4)\n.model NCH NMOS');
  assert.deepEqual([n!.type, n!.kind, pins(n).join(' ')], ['vdmos', 'nmos', 'D=d G=g S=s']);
  assert.deepEqual([p!.type, p!.kind, pins(p).join(' ')], ['vdmos', 'pmos', 'D=d G=g S=s']);
  assert.deepEqual([bulk!.type, pins(bulk).join(' ')], ['mosfet', 'D=d G=g S=s B=b']);
});

// 7. `Z` is an IGBT with an NIGBT/PIGBT model, a MESFET otherwise.
test('Z is an IGBT when its model is NIGBT or PIGBT, else a MESFET', () => {
  const [igbt, pigbt, mesfet] = parts('Z1 c g e IGBT1\nZ2 c g e IGBT2\nZ3 d g s MES\n.model IGBT1 NIGBT\n.model IGBT2 PIGBT\n.model MES NMF');
  assert.deepEqual([igbt!.type, igbt!.title, pins(igbt).join(' ')], ['igbt', 'IGBT (N)', 'C=c G=g E=e']);
  assert.equal(pigbt!.title, 'IGBT (P)');
  assert.deepEqual([mesfet!.type, pins(mesfet).join(' ')], ['mesfet', 'D=d G=g S=s']);
});

// 8. `I … R=` and `B … R=` are resistors.
test('I and B with R= are drawn as resistors', () => {
  const [i, b, src] = parts('I1 a 0 R=1k\nB1 a 0 R=V(a)*2\nI2 a 0 1m');
  assert.deepEqual([i!.type, i!.kind, pins(i).join(' ')], ['resistor', 'resistor', 'A=a B=0']);
  assert.deepEqual([b!.type, b!.kind], ['resistor', 'resistor']);
  assert.deepEqual([src!.type, src!.kind], ['isource', 'isource']);
});

// 9. E/G/F/H `value=` have two nodes; `Laplace=` and `tbl=`/`table=` keep four.
test('value= sources have two nodes; Laplace= and tbl=/table= sources keep their controlling pair', () => {
  const found = parts(['E1 1 0 value={V(a)*2}', 'G1 1 0 a 0 tbl=(0 0 1 1m)', 'E2 1 0 a 0 table=(0,0,1,1)', 'E3 1 0 a 0 Laplace=1/(1+s)', 'F1 1 0 value={I(V1)}', 'E4 1 0 a 0 2'].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, pins(part).join(' ')]), [
    ['E1', 'n+=1 n-=0'],
    ['G1', 'n+=1 n-=0 nc+=a nc-=0'],
    ['E2', 'n+=1 n-=0 nc+=a nc-=0'],
    ['E3', 'n+=1 n-=0 nc+=a nc-=0'],
    ['F1', '+=1 -=0'],
    ['E4', 'n+=1 n-=0 nc+=a nc-=0']
  ]);
});

// 10. `.lib file` with one argument reads the whole file for its models and subcircuits, but its
//     elements at global scope are not part of the circuit (LTspice help: "Circuit elements at global scope are ignored").
test('.lib file alone reads the whole file: its models and subcircuits are used, its global elements are not drawn', () => {
  const { parts: found, notes } = netlist('.lib models.lib\nQ1 c b e BC547\nX1 in out OPA\nD1 a k 1N4148', {
    'models.lib': '.model BC547 NPN(BF=200)\nR9 x 0 1k\n.subckt OPA in out\nR1 in out 1k\n.ends\n.model 1N4148 D(Is=1n)\nC9 y 0 1n'
  });
  assert.deepEqual(found.map((part) => [part.ref, part.kind]), [['Q1', 'npn'], ['X1', 'block'], ['D1', 'diode']]);
  assert.deepEqual(notes, ['Line 1: 2 elements at the top level of models.lib are not part of the circuit; LTspice ignores them in a .lib file.']);
  assert.deepEqual(netlist('.lib models.lib\nR1 a 0 1', { 'models.lib': '.model X NPN' }).notes, [], 'no note when the library has no top-level element');
});

// 11. A `.lib` whose file is not here is noted, not an error: LTspice resolves bare names such as
//     standard.dio against its own library folder, which the preview cannot see.
test('.lib of a file that is not here — a standard library — is noted and skipped, not an error', () => {
  const { parts: found, notes } = netlist('.lib standard.dio\n.lib UniversalOpAmps2.sub\n.lib "C:\\Users\\me\\user.dio"\nR1 a 0 1k', { 'UniversalOpAmps2.sub': { error: 'the file does not exist' } });
  assert.deepEqual(found.map((part) => part.ref), ['R1']);
  assert.deepEqual(notes, [
    'Line 1: .lib standard.dio is not read: the file is not here. LTspice reads it from its own library folder.',
    'Line 2: .lib UniversalOpAmps2.sub is not read: the file does not exist. LTspice reads it from its own library folder.',
    'Line 3: .lib C:\\Users\\me\\user.dio is not read: only paths relative to the Markdown document are read. LTspice reads it from its own library folder.'
  ]);
  assert.equal(error('.include standard.dio\nR1 a 0 1k').message, 'standard.dio could not be read.', '.include of a missing file is still an error');
  assert.equal(error('.lib corners.lib tt\nR1 a 0 1k').message, 'corners.lib could not be read.', 'a sectioned .lib of a missing file is still an error');
});

// 12. Quoted paths with spaces are one token, and `.lib file section` works as in ngspice.
test('a quoted path with spaces names one file, and .lib file section still reads only that section', () => {
  const files = { 'my models/bjt.lib': '.model Q1 PNP', 'corners.lib': '.lib tt\n.model N NMOS\n.endl\n.lib ff\n.model N PMOS\n.endl' };
  assert.equal(parts('.include "my models/bjt.lib"\nQ1 c b e Q1', files)[0]!.kind, 'pnp');
  assert.equal(parts('.lib "corners.lib" ff\nM1 d g s s N', files)[0]!.kind, 'pmos');
});

test('includeReferences lists every .include, .lib file and .lib file section an LTspice netlist names, unquoted', () => {
  assert.deepEqual(includeReferences('.lib standard.dio\n.include "my models/bjt.lib"\n.lib "corners.lib" tt\n.lib x.lib\n.endl\n* .include nope.lib', '', 'ltspice'), ['standard.dio', 'my models/bjt.lib', 'corners.lib']);
});

// --- Decks in the shape LTspice exports (test/fixtures/ltspice/, written for this project) ---------------

const CORPUS = join('test', 'fixtures', 'ltspice');

/** What each deck must read as: the parts drawn, and the notes the standard-library lines leave. */
const DECKS: Record<string, { parts: string[]; notes: string[] }> = {
  'inverting-amplifier.net': {
    parts: ['V1:vsource', 'R1:resistor', 'R2:resistor', 'XU1:block', 'V2:vsource', 'V3:vsource', 'C1:capacitor', 'D1:diode'],
    notes: [
      'Line 11: .lib C:\\Users\\me\\Documents\\LTspiceXVII\\lib\\cmp\\standard.dio is not read: only paths relative to the Markdown document are read. LTspice reads it from its own library folder.',
      'Line 12: .lib UniversalOpAmps2.sub is not read: the file is not here. LTspice reads it from its own library folder.',
      'Line 5: subcircuit UniversalOpAmp2 of XU1 is not defined here; its pins are numbered.'
    ]
  },
  'buck-converter.net': {
    parts: ['V1:vsource', 'M1:nmos', 'M2:pmos', 'L1:inductor', 'C1:capacitor', 'I1:resistor', 'A1:block', 'A2:block', 'V2:vsource', '@1:block', '&1:block'],
    notes: ['Line 17: .lib standard.mos is not read: the file is not here. LTspice reads it from its own library folder.']
  }
};

test('every fixture deck is listed, and each reads into the expected parts with only the standard-library notes', () => {
  assert.deepEqual(readdirSync(CORPUS).filter((name) => name.endsWith('.net')).sort(), Object.keys(DECKS).sort());
  for (const [name, expected] of Object.entries(DECKS)) {
    const { parts: found, notes } = netlist(readFileSync(join(CORPUS, name), 'utf8'));
    assert.deepEqual(found.map((part) => `${part.ref}:${part.kind}`), expected.parts, name);
    assert.deepEqual(notes, expected.notes, name);
  }
});

test('the buck converter deck: VDMOS switches are three-pin and P by pchan, A functions are titled, $ and ; comments are read as LTspice does', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'buck-converter.net'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual(pins(by('M1')), ['D=vin', 'G=sw', 'S=gate']);
  assert.equal(by('M2').kind, 'pmos');
  assert.equal(by('I1').value, 'R=5 $ the load drawn as a resistor', 'the comma is a separator, as in every SPICE dialect');
  assert.deepEqual([by('A1').title, by('A2').title], ['BUF', 'INV']);
  assert.equal(by('M1').value, 'IRF540');
  assert.equal(by('L1').value, '22µ Rser=20m');
});
