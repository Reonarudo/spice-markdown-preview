/**
 * What the reader makes of HSPICE netlists read through the generated HSPICE parser: one case
 * per finding of the HSPICE research (Redmine #1187) that changes what is drawn, resolved by the
 * catalogue (#1192, #1197) and the dialect decisions (no title line, ADR 0006; the first `.end`
 * ends the netlist, #1195). `test/parser-hspice.test.ts` says how the lines are cut into tokens.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { includeReferences, parseNetlist, type IncludeSet, type Netlist, type Part } from '../src/netlist';
import { loadHspice } from './helpers/hspice';

before(loadHspice);

function netlist(source: string, files: IncludeSet['files'] = {}): Netlist {
  const result = parseNetlist(source, { files }, 'hspice');
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function parts(source: string, files?: IncludeSet['files']): Part[] {
  return netlist(source, files).parts;
}

function error(source: string, files: IncludeSet['files'] = {}) {
  const result = parseNetlist(source, { files }, 'hspice');
  if (result.ok) assert.fail('expected an error');
  return result;
}

/** A part's pins as `name=node` strings. */
function pins(part: Part | undefined): string[] {
  return (part?.pins ?? []).map((pin) => `${pin.name}=${pin.node}`);
}

// 1. `$` comments after a blank, a comma or a number; `;` is a name character (disagreements 1 and 2).
test('a $ after a blank or a number ends the line, and ; stays inside a node name', () => {
  const [r1, r2, r3] = parts('R1 a b 1k $ load\nR2 a;b out 2k,$ comma\nR3 c d 3k$x');
  assert.deepEqual([r1!.value, pins(r2), r2!.value, r3!.value], ['1k', ['A=a;b', 'B=out'], '2k', '3k']);
  assert.match(error('R1 a b 1k\nR2 1$ 2 1k').message, /^R2 needs 2 nodes; found 1\./);
});

// 2. Ground has five spellings (UG p.60, 63; disagreement 7).
test('0, GND, GND!, GROUND and !GND are all ground', () => {
  const found = parts('R1 a 0 1k\nR2 a GND 1k\nR3 a gnd! 1k\nR4 a GROUND 1k\nR5 a !gnd 1k');
  assert.deepEqual(found.map((part) => pins(part)[1]), ['B=0', 'B=0', 'B=0', 'B=0', 'B=0']);
});

// 3. B, S, W, U and P are HSPICE's devices (disagreements 9–13); A, N, O, Y and Z are not elements.
test('B is an IBIS buffer with pins named by buffer=, else numbered; S an n-port with numbered pins; P a two-node port', () => {
  const [b1, b2, s1, p1] = parts("B1 pu pd out in file='x.ibs' model='m' buffer=2\nB2 a b c file='x.ibs' model='m'\nS1 nd1 nd2 0 MNAME=smod\nP1 in 0 port=1 z0=50");
  assert.deepEqual([b1!.type, b1!.kind, b1!.title, pins(b1).join(' ')], ['ibis-buffer', 'block', 'IBIS buffer', 'nd_pu=pu nd_pd=pd nd_out=out nd_in=in']);
  assert.deepEqual(pins(b2), ['1=a', '2=b', '3=c']);
  assert.deepEqual([s1!.type, s1!.title, pins(s1).join(' '), s1!.value], ['nport', 'n-port', '1=nd1 2=nd2 3=0', 'MNAME=smod']);
  assert.deepEqual([p1!.type, p1!.title, pins(p1).join(' ')], ['port', 'port', '+=in -=0']);
});

test('W is a coupled lossy line with N= conductors, its nodes and parameters mixed; U a lumped lossy line ending at its model', () => {
  const [w1, w2, u1] = parts('W1 in1 in2 gnd out1 out2 gnd N=2 L=0.1 RLGCMODEL=pair\nW2 N=1 a 0 b 0 RLGCMODEL=single l=0.1\nU1 in1 in2 refin out1 out2 refout umod L=1\n.MODEL umod U LEVEL=3');
  assert.deepEqual([w1!.type, w1!.title, pins(w1).join(' ')], ['coupled-lossy-line', 'coupled line', 'in1=in1 in2=in2 refin=0 out1=out1 out2=out2 refout=0']);
  assert.deepEqual(pins(w2), ['in1=a', 'refin=0', 'out1=b', 'refout=0']);
  assert.deepEqual([u1!.type, u1!.title, pins(u1).join(' '), u1!.value], ['lumped-lossy-line', 'lossy line', 'in1=in1 in2=in2 refin=refin out1=out1 out2=out2 refout=refout', 'umod L=1']);
});

test('A, N, O, Y and Z are not element names in HSPICE', () => {
  for (const letter of ['A', 'N', 'O', 'Y', 'Z']) {
    assert.equal(error(`R1 a 0 1k\n${letter}1 a b c m`).message, `"${letter}1" is not an element name. Element names start with a letter, e.g. R1.`);
  }
});

// 4. E and G keep four nodes in their keyword forms, with the keyword between the pairs (UG p.216–253; disagreements 14–16).
test('LAPLACE, DELAY, POLE, FREQ, FOSTER, OPAMP, TRANSFORMER, PWL, VCR and VCCAP sources have four pins; bare POLY four, POLY(n) 2 + 2n, AND(k) 2 + 2k; VOL=, CUR= and NOISE= two', () => {
  const found = parts([
    'E1 1 0 LAPLACE 3 0 1 / 1 1',
    'E2 1 0 DELAY 3 0 TD=1n',
    'E3 1 0 POLE 3 0 1 / 1 1 2',
    'E4 1 0 FREQ 3 0 1k 0 0 10k -3 -45',
    'E5 1 0 FOSTER 3 0 1 (1,2)/(3,4)',
    'E6 1 0 OPAMP 3 0',
    'E7 1 0 TRANSFORMER 3 0 10',
    'E8 1 0 PWL(1) 3 0 0,0 1,1',
    'G1 1 0 VCR 3 0 1k',
    'G2 1 0 VCCAP 3 0 1p',
    'G3 1 0 NPWL(1) 3 0 0,0 1,1',
    'E9 3 4 POLY 21 17 10.5 2.1 1.75',
    'E10 3 4 POLY(2) 21 17 5 6 10.5 2.1 1.75',
    'E11 1 0 AND(2) 3 0 4 0 0,0 1,1',
    "E12 1 0 VOL='v(3)*2'",
    "G4 1 0 CUR='v(3)*2'",
    "G5 1 0 NOISE='1e-15'",
    'E13 2 3 14 1 2.0',
    'E14 2 3 14 1 MAX=+5 MIN=-5 2.0'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, pins(part).join(' ')]), [
    ['E1', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E2', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E3', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E4', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E5', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E6', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E7', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E8', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['G1', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['G2', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['G3', 'n+=1 n-=0 nc+=3 nc-=0'],
    ['E9', 'n+=3 n-=4 nc1+=21 nc1-=17'],
    ['E10', 'n+=3 n-=4 nc1+=21 nc1-=17 nc2+=5 nc2-=6'],
    ['E11', 'n+=1 n-=0 nc1+=3 nc1-=0 nc2+=4 nc2-=0'],
    ['E12', 'n+=1 n-=0'],
    ['G4', 'n+=1 n-=0'],
    ['G5', 'n+=1 n-=0'],
    ['E13', 'n+=2 n-=3 nc+=14 nc-=1'],
    ['E14', 'n+=2 n-=3 nc+=14 nc-=1']
  ]);
  assert.equal(found[0]!.value, 'LAPLACE 1 / 1 1');
});

test('an optional VCVS or VCCS keyword before the controlling pair, or before POLY(n), is not a node', () => {
  const [e1, e2, g1] = parts('E1 2 3 VCVS 14 1 2.0\nE2 1 0 VCVS POLY(2) 3 0 4 0 0 1 1\nG1 1 0 VCCS 3 0 1m');
  assert.deepEqual([pins(e1).join(' '), pins(e2).join(' '), pins(g1).join(' ')], ['n+=2 n-=3 nc+=14 nc-=1', 'n+=1 n-=0 nc1+=3 nc1-=0 nc2+=4 nc2-=0', 'n+=1 n-=0 nc+=3 nc-=0']);
  assert.equal(e2!.value, 'VCVS POLY(2) 0 1 1');
});

// 5. M may leave off its bulk and J may add one (UG p.167–171; disagreements 17 and 18).
test('a three-node M takes its bulk from the model, and a four-node J has a bulk pin', () => {
  const [m1, m2, j1, j2] = parts('M1 d g s nch W=1u L=1u\nM2 d g s b pch\nJ1 d g s b jm\nJ2 d g s jm\n.MODEL nch NMOS\n.MODEL pch PMOS\n.MODEL jm NJF');
  assert.deepEqual([m1!.kind, pins(m1).join(' '), m1!.value], ['nmos', 'D=d G=g S=s', 'nch W=1u L=1u']);
  assert.deepEqual([m2!.kind, pins(m2).join(' ')], ['pmos', 'D=d G=g S=s B=b']);
  assert.deepEqual([j1!.title, pins(j1).join(' '), pins(j2).join(' ')], ['JFET (N)', 'D=d G=g S=s B=b', 'D=d G=g S=s']);
});

// 6. R and C put their model before the value (UG p.128, 134; disagreement 19).
test('R, C and L keep a model written before the value as part of the value text', () => {
  const [r, c, l] = parts("R1 a b rmod 10k TC1=0.01\nC1 a 0 cmod 1p\nL1 a 0 lmod 1n\nR2 1 0 'abs(v(c)) + abs(v(d))'\n.MODEL rmod R\n.MODEL cmod C\n.MODEL lmod L");
  assert.deepEqual([r!.kind, r!.value, c!.kind, c!.value, l!.kind, l!.value], ['resistor', 'rmod 10k TC1=0.01', 'capacitor', 'cmod 1p', 'inductor', 'lmod 1n']);
  assert.equal(parts("R2 1 0 'abs(v(c)) + abs(v(d))'")[0]!.value, "'abs(v(c)) + abs(v(d))'");
});

// 7. The automatic model selector: `pch` picks among `pch.1`, `pch.2` … by geometry (SH 15-8; disagreement 21).
test('a model name with no definition of its own is found among its selector-suffixed definitions, and a dotted name is exact', () => {
  const { parts: found, notes } = netlist('M1 d g s b pch W=1u L=1u\nM2 d g s b nch.2 W=1u L=1u\nM3 d g s b nch W=1u L=1u\nQ1 c b e qp\n.MODEL pch.1 PMOS LEVEL=49\n.MODEL pch.2 PMOS LEVEL=49\n.MODEL nch.2 NMOS\n.MODEL qp.1 PNP');
  assert.deepEqual(found.map((part) => [part.ref, part.kind]), [['M1', 'pmos'], ['M2', 'nmos'], ['M3', 'nmos'], ['Q1', 'pnp']]);
  assert.deepEqual(notes, []);
  assert.deepEqual(netlist('M1 d g s b pch\n.MODEL pchx.1 PMOS').notes, ['Line 1: model pch of M1 is not defined here; drawn as NMOS.'], 'a longer name is not a selector match');
});

// 8. `.MACRO` … `.EOM` define a subcircuit (CR p.91, 147).
test('.MACRO and .EOM define a subcircuit whose body is not drawn at the top level, and a call takes its port names and parameters without params:', () => {
  const { parts: found, notes } = netlist('X1 in out INV W=2u M=2\n.MACRO INV IN OUT W=1u\nMP OUT IN vdd! vdd! pch W=W\nMN OUT IN gnd! gnd! nch W=W\n.EOM INV\n.MODEL pch PMOS\n.MODEL nch NMOS');
  assert.deepEqual(found.map((part) => [part.ref, part.kind, part.title, pins(part).join(' '), part.value]), [['X1', 'block', 'INV', 'IN=in OUT=out', 'W=2u M=2']]);
  assert.deepEqual(notes, []);
});

// 9. `.DATA`, `.PROTECT` and `.ALTER` blocks are not elements (CR p.28, 57, 227; disagreements 22 and 23).
test('.DATA rows and encrypted .PROTECT text draw nothing, and the first .ALTER ends the circuit with a note', () => {
  const { parts: found, notes } = netlist('R1 a 0 1k\n.DATA sweep W1 W2 L CAP\n1u 2u 0.5u 1p\nVBS VDS L\n.ENDDATA\n.PROTECT\nQ3bXz9== encrypted\n.UNPROTECT\n.ALTER second run\nR1 a 0 2k\nR2 a 0 3k\n.END\nR9 a 0 4k');
  assert.deepEqual(found.map((part) => part.ref), ['R1']);
  assert.deepEqual(notes, [
    'Line 12: 1 line after .end is not read.',
    'Line 6: the lines between .protect and .unprotect are not read.',
    'Line 9: .alter and everything after it are not read; they change the circuit for a second run.'
  ]);
  assert.deepEqual(netlist('R1 a 0 1k\n.ALTER\nR1 a 0 2k').notes, ['Line 2: .alter and everything after it are not read; they change the circuit for a second run.'], 'an .alter with no .end');
});

// 10. `.CONNECT node1 node2` merges two nodes under the first name (CR p.51; disagreement 23).
test('.CONNECT joins two nodes into one net named after the first', () => {
  const found = parts('R1 a out2 1k\nR2 out 0 1k\nR3 x gnd! 1k\n.CONNECT out2 out\n.CONNECT 0 x');
  assert.deepEqual(found.map((part) => pins(part).join(' ')), ['A=a B=out2', 'A=out2 B=0', 'A=0 B=0']);
});

// 11. `.LIB 'file' entry` reads a section, and a section may call sections of the same file (UG p.67; CR p.137–139).
test('.LIB file entry reads the section up to its .ENDL, a section calling another section of its own file included; .LIB file alone is an error', () => {
  const lib = ".LIB tt\n.LIB 'cmos.lib' common\n.MODEL nch.1 NMOS\n.ENDL tt\n.LIB common\n.MODEL pch PMOS\n.ENDL common\nR9 x 0 1k\n";
  const { parts: found, notes } = netlist(".LIB 'cmos.lib' tt\nM1 d g s b nch W=1u L=1u\nM2 d g s b pch W=1u L=1u", { 'cmos.lib': lib });
  assert.deepEqual([found.map((part) => part.kind), notes], [['nmos', 'pmos'], []]);
  assert.equal(error(".LIB 'cmos.lib' tt\n.LIB 'cmos.lib' tt\nR1 a 0 1k", { 'cmos.lib': ".LIB tt\n.LIB 'cmos.lib' tt\n.ENDL\n" }).message, 'In cmos.lib, line 2: cmos.lib includes itself.', 'a section calling itself is still a cycle');
  assert.equal(error(".LIB 'cmos.lib'\nR1 a 0 1k", { 'cmos.lib': lib }).message, ".lib 'cmos.lib' needs a section name, e.g. .lib 'cmos.lib' tt; hspice reads a library only by section.");
});

test('includeReferences lists every .INC and .LIB file an HSPICE netlist names, unquoted, and skips a section definition', () => {
  assert.deepEqual(includeReferences(".LIB 'models.lib' tt\n.INC 'sub.inc'; $ ignored\n.LIB local\n.ENDL\n* .INC nope.inc", '', 'hspice'), ['models.lib', 'sub.inc']);
});

// 12. Several circuits in one file: only the first is drawn, with a note (CR p.82; disagreement 25).
test('the first .END ends the netlist with a note for the next simulation', () => {
  const { parts: found, notes } = netlist('R1 a 0 1k\n.END $ first\n.TITLE second\nR2 a 0 1k\n.END');
  assert.deepEqual([found.map((part) => part.ref), notes], [['R1'], ['Line 2: 3 lines after .end are not read.']]);
});

// --- Decks in the shape of the HSPICE User Guide's examples (test/fixtures/hspice/, written for this project) ----

const CORPUS = join('test', 'fixtures', 'hspice');

/** What each deck must read as: the parts drawn, and the notes left. */
const DECKS: Record<string, { parts: string[]; notes: string[] }> = {
  'cmos-inverter.sp': {
    parts: ['VDD:vsource', 'VIN:vsource', 'X1:block', 'X2:block', 'CL:capacitor', 'RL:resistor', 'M3:nmos', 'J1:block'],
    notes: [
      'Line 36: 3 lines after .end are not read.',
      'Line 31: the lines between .protect and .unprotect are not read.',
      'Line 34: .alter and everything after it are not read; they change the circuit for a second run.'
    ]
  },
  'si-channel.sp': {
    parts: [
      'VDD:vsource', 'B1:block', 'W1:block', 'U1:block', 'S1:block', 'P1:block', 'EAMP:block', 'EDLY:block', 'GSUM:block', 'EOP:block',
      'GN:block', 'EV:block', 'T1:block', 'RT:resistor', 'VIN:vsource'
    ],
    notes: []
  }
};

test('every fixture deck is listed, and each reads into the expected parts and notes', () => {
  assert.deepEqual(readdirSync(CORPUS).filter((name) => name.endsWith('.sp')).sort(), Object.keys(DECKS).sort());
  for (const [name, expected] of Object.entries(DECKS)) {
    const { parts: found, notes } = netlist(readFileSync(join(CORPUS, name), 'utf8'));
    assert.deepEqual(found.map((part) => `${part.ref}:${part.kind}`), expected.parts, name);
    assert.deepEqual(notes, expected.notes, name);
  }
});

test('the inverter deck: macro calls with parameters, ground aliases, a three-node MOSFET through the model selector, .CONNECT, and the second run left out', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'cmos-inverter.sp'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual([pins(by('X1')), by('X1').value], [['IN=in', 'OUT=out1'], 'W=2u M=2']);
  assert.deepEqual([pins(by('X2')), by('X2').value], [['IN=out1', 'OUT=out2'], "W='wn * 2'"]);
  assert.deepEqual([pins(by('CL')), by('CL').value], [['A=out2', 'B=0'], 'cmod 10f']);
  assert.deepEqual([pins(by('RL')), by('RL').value], [['A=out2', 'B=0'], 'rmod 1MEG'], '.CONNECT joins out to out2; ground is ground');
  assert.deepEqual(pins(by('M3')), ['D=out2', 'G=out1', 'S=0']);
  assert.deepEqual([by('J1').title, pins(by('J1'))], ['JFET (P)', ['D=d', 'G=g', 'S=s', 'B=b']]);
  assert.deepEqual(pins(by('VIN')), ['+=in', '-=0']);
});

test('the channel deck: the IBIS buffer, coupled and lumped lines, n-port, port and every HSPICE dependent-source shape', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'si-channel.sp'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual(pins(by('B1')), ['nd_pu=vdd!', 'nd_pd=0', 'nd_out=pad', 'nd_in=din']);
  assert.deepEqual(pins(by('W1')), ['in1=pad', 'in2=agg', 'refin=0', 'out1=rx1', 'out2=rx2', 'refout=0']);
  assert.deepEqual(pins(by('U1')), ['in1=rx1', 'in2=rx2', 'refin=0', 'out1=pk1', 'out2=pk2', 'refout=0']);
  assert.deepEqual(pins(by('S1')), ['1=pk1', '2=pk2', '3=0']);
  assert.deepEqual(pins(by('P1')), ['+=pk2', '-=0']);
  assert.deepEqual(['EAMP', 'EDLY', 'EOP', 'GN', 'EV', 'T1'].map((ref) => pins(by(ref)).length), [4, 4, 4, 2, 2, 4]);
  assert.deepEqual(pins(by('GSUM')), ['n+=0', 'n-=sum', 'nc1+=amp', 'nc1-=0', 'nc2+=dly', 'nc2-=0']);
});
