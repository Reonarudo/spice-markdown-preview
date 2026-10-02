/**
 * What the reader makes of Xyce netlists read through the generated Xyce parser: one case per
 * finding of the Xyce research (Redmine #1188) that changes what is drawn, resolved by the
 * catalogue (#1192, #1197) and the dialect decisions (no title line, ADR 0006; the first `.end`
 * ends the netlist, #1195). `test/parser-xyce.test.ts` says how the lines are cut into tokens.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { includeReferences, parseNetlist, type IncludeSet, type Netlist, type Part } from '../src/netlist';
import { loadXyce } from './helpers/xyce';

before(loadXyce);

function netlist(source: string, files: IncludeSet['files'] = {}): Netlist {
  const result = parseNetlist(source, { files }, 'xyce');
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function parts(source: string, files?: IncludeSet['files']): Part[] {
  return netlist(source, files).parts;
}

function error(source: string, files: IncludeSet['files'] = {}) {
  const result = parseNetlist(source, { files }, 'xyce');
  if (result.ok) assert.fail('expected an error');
  return result;
}

/** A part's pins as `name=node` strings. */
function pins(part: Part | undefined): string[] {
  return (part?.pins ?? []).map((pin) => `${pin.name}=${pin.node}`);
}

// 1. An indented line is a comment; `$` and `//` are text (RG §2.1.39.1; disagreements 1–3).
test('an indented element is not drawn, $GVDD is a node, and // stays in the value', () => {
  const found = parts('R1 $GVDD out 1k\n  R2 out 0 2k\nR3 out 0 3k // text');
  assert.deepEqual(found.map((part) => [part.ref, pins(part).join(' '), part.value]), [['R1', 'A=$gvdd B=out', '1k'], ['R3', 'A=out B=0', '3k // text']]);
});

// 2. Only `0` is ground, unless `.PREPROCESS REPLACEGROUND TRUE` makes `gnd`, `gnd!` and `ground` ground too (RG §2.1.28; disagreement 5).
test('gnd is an ordinary node, and ground only once the netlist says .PREPROCESS REPLACEGROUND TRUE, wherever that line stands', () => {
  assert.deepEqual(parts('R1 a gnd 1k\nR2 a 0 1k').map((part) => pins(part)[1]), ['B=gnd', 'B=0']);
  const found = parts('R1 a gnd 1k\nR2 a GND! 1k\nR3 a Ground 1k\nR4 a 0 1k\n.PREPROCESS REPLACEGROUND TRUE');
  assert.deepEqual(found.map((part) => pins(part)[1]), ['B=0', 'B=0', 'B=0', 'B=0']);
  assert.deepEqual(parts('R1 a gnd 1k\n.PREPROCESS REPLACEGROUND FALSE').map((part) => pins(part)[1]), ['B=gnd']);
  assert.deepEqual(parts('R1 a gnd 1k\n.PREPROCESS REMOVEUNUSED C,D').map((part) => pins(part)[1]), ['B=gnd'], 'another .PREPROCESS option changes nothing');
});

// 3. `Y<type> <name>` devices, named by their second token (RG Table 2-35; disagreement 6).
test('a catalogued Y device takes its pins from the catalogue; any other Y type is a block titled by the type with numbered pins', () => {
  const [mr, dly, line, pde, lin, acc, op] = parts([
    'YMEMRISTOR mr1 a b mrm',
    'YDELAY dly1 dout 0 din 0 TD=10n',
    'YTRANSLINE line1 inn out tlmod len=12 lumps=1440',
    'YPDE pde1 anode cathode gate zmod',
    'YLIN lin1 p1 0 p2 0 linmod',
    'YACC acc1 acc vel pos v0=10 x0=0',
    'YOPAMP op1 inp inn out',
    '.MODEL mrm memristor', '.MODEL tlmod transline', '.MODEL zmod ZOD', '.MODEL linmod LIN'
  ].join('\n'));
  assert.deepEqual([mr!.ref, mr!.type, mr!.kind, mr!.title, pins(mr).join(' '), mr!.value], ['mr1', 'memristor', 'block', 'memristor', '+=a -=b', 'mrm']);
  assert.deepEqual([dly!.ref, dly!.type, pins(dly).join(' '), dly!.value], ['dly1', 'ideal-delay', 'out+=dout out-=0 in+=din in-=0', 'TD=10n']);
  assert.deepEqual([line!.ref, line!.type, pins(line).join(' '), line!.value], ['line1', 'transline', 'in=inn out=out', 'tlmod len=12 lumps=1440']);
  assert.deepEqual([pde!.ref, pde!.type, pde!.title, pins(pde).join(' '), pde!.value], ['pde1', 'pde-device', 'PDE', '1=anode 2=cathode 3=gate', 'zmod']);
  assert.deepEqual([lin!.ref, lin!.type, lin!.title, pins(lin).join(' '), lin!.value], ['lin1', 'nport', 'n-port', '1=p1 2=0 3=p2 4=0', 'linmod']);
  assert.deepEqual([acc!.ref, acc!.type, acc!.title, pins(acc).join(' '), acc!.value], ['acc1', 'xyce-device', 'ACC', '1=acc 2=vel 3=pos', 'v0=10 x0=0']);
  assert.deepEqual([op!.ref, op!.title, pins(op).join(' ')], ['op1', 'OPAMP', '1=inp 2=inn 3=out']);
});

test('a Y device named like an element letter is still named by its second token, and a Y line with only its type is an error at the end of the line', () => {
  const [r] = parts('YMEMRISTOR r1 a b m\n.MODEL m memristor');
  assert.deepEqual([r!.ref, r!.type], ['r1', 'memristor']);
  assert.match(error('R1 a 0 1k\nYMEMRISTOR').message, /^Unexpected end of line; expected word\./);
});

// 4. `U` is a digital gate with its supply pins first; `P` a port; `A` and `N` are not elements (RG §2.3.28, §2.3.11; disagreements 7–9).
test('U gates take DPWR and DGND then their inputs and output by type, NOT included; P is a two-node port', () => {
  const [and, inv, dff, p] = parts('U1 AND(2) $GVDD 0 a b y dmod\nUINV NOT $GVDD 0 y yb dmod\nU2 DFF $GVDD 0 preb clrb clk d q qb dmod\nP1 in 0 port=1 Z0=50\n.MODEL dmod DIG');
  assert.deepEqual([and!.type, and!.kind, and!.title, pins(and).join(' '), and!.value], ['digital-gate', 'block', 'AND(2)', 'DPWR=$gvdd DGND=0 in1=a in2=b out=y', 'dmod']);
  assert.deepEqual([inv!.title, pins(inv).join(' ')], ['NOT', 'DPWR=$gvdd DGND=0 in=y out=yb']);
  assert.deepEqual([dff!.type, dff!.title, pins(dff).join(' ')], ['digital-flip-flop', 'DFF', 'DPWR=$gvdd DGND=0 PRE=preb CLR=clrb CLK=clk D=d Q=q Q̅=qb']);
  assert.deepEqual([p!.type, p!.title, pins(p).join(' '), p!.value], ['port', 'port', '+=in -=0', 'port=1 Z0=50']);
});

test('A and N are not element names in Xyce', () => {
  for (const letter of ['A', 'N']) {
    assert.equal(error(`R1 a 0 1k\n${letter}1 a b c m`).message, `"${letter}1" is not an element name. Element names start with a letter, e.g. R1.`);
  }
});

// 5. The generic switch `S n+ n- model CONTROL={…}` has two nodes (RG §2.3.22; disagreement 10).
test('S with CONTROL= has two pins and keeps its model; the four-node S is unchanged', () => {
  const [s1, s2] = parts('S1 1 2 SWI OFF CONTROL={I(VMON)}\nS2 3 4 5 6 swv ON\n.MODEL SWI SWITCH\n.MODEL swv VSWITCH');
  assert.deepEqual([s1!.type, s1!.title, pins(s1).join(' '), s1!.value], ['vswitch', 'switch', 'n+=1 n-=2', 'SWI OFF CONTROL={I(VMON)}']);
  assert.deepEqual([pins(s2).join(' '), s2!.value], ['n+=3 n-=4 nc+=5 nc-=6', 'swv ON']);
});

// 6. `K` couples one or more inductors and may name a core model (RG §2.3.6; disagreement 11).
test('a K line with three inductors and a core model is noted, not drawn', () => {
  const { parts: found, notes } = netlist('L1 a b 1u\nL2 b c 1u\nL3 c 0 1u\nK1 L1 L2 L3 0.9 core\nK2 L1 1 core\n.MODEL core CORE');
  assert.deepEqual(found.map((part) => part.ref), ['L1', 'L2', 'L3']);
  assert.deepEqual(notes, ['Line 4: mutual inductance K1 (L1 L2 L3 0.9 core) is not drawn.', 'Line 5: mutual inductance K2 (L1 1 core) is not drawn.']);
});

// 7. `M` and `Q` node counts follow the model's level; a named substrate is `[SUB]` (RG §2.3.17, §2.3.20; disagreements 12 and 13).
test('an MVS MOSFET has three nodes, a BSIM-SOI one four to seven, a level-18 one is a VDMOS, and a plain one four', () => {
  const [m1, m2, m3, m4] = parts('M1 d g s mvs L=1u\nM2 d g s e p b t soi\nM3 d g s vd\nM4 d g s b nch\n.MODEL mvs NMOS LEVEL=2000\n.MODEL soi PMOS LEVEL=10\n.MODEL vd PMOS LEVEL=18\n.MODEL nch NMOS LEVEL=9');
  assert.deepEqual([m1!.type, m1!.kind, pins(m1).join(' '), m1!.value], ['mosfet', 'nmos', 'D=d G=g S=s', 'mvs L=1u']);
  assert.deepEqual([m2!.type, m2!.kind, pins(m2).join(' ')], ['soi-mosfet', 'pmos', 'D=d G=g S=s B=e P=p body=b T=t']);
  assert.deepEqual([m3!.type, m3!.kind, pins(m3).join(' ')], ['vdmos', 'pmos', 'D=d G=g S=s']);
  assert.deepEqual([m4!.kind, pins(m4).join(' ')], ['nmos', 'D=d G=g S=s B=b']);
});

test('Q takes a bracketed substrate name as that node, and a HICUM or VBIC transistor its thermal node', () => {
  const [q1, q2, q3] = parts('Q1 c b e [SUB] qp 2\nQ2 c b e s dt qh\nQ3 c b e qn\n.MODEL qp PNP\n.MODEL qh NPN LEVEL=230\n.MODEL qn NPN');
  assert.deepEqual([q1!.kind, pins(q1).join(' '), q1!.value], ['pnp', 'C=c B=b E=e S=sub', 'qp 2']);
  assert.deepEqual([q2!.kind, pins(q2).join(' ')], ['npn', 'C=c B=b E=e S=s tj=dt']);
  assert.deepEqual(pins(q3), ['C=c', 'B=b', 'E=e']);
});

// 8. `R`, `C` and `L` name a model before the value, or give the value as `R=` (RG §2.3.4; disagreement 14).
test('a passive keeps a model written before its value as part of the value text, and R= alone is a value', () => {
  const [r1, c1, l1, r2] = parts('R1 a b rmod 1k TC1=0.01\nC1 a 0 cmod 1p\nL1 a 0 lmod 1n\nR2 a 0 R={100 * 2}\n.MODEL rmod R\n.MODEL cmod C\n.MODEL lmod L');
  assert.deepEqual([r1!.kind, r1!.value, c1!.kind, c1!.value, l1!.kind, l1!.value, r2!.value], ['resistor', 'rmod 1k TC1=0.01', 'capacitor', 'cmod 1p', 'inductor', 'lmod 1n', 'R={100 * 2}']);
});

// 9. `E`/`G` forms are ngspice's; `VOL` is Xyce's synonym for `VALUE` (RG §2.3.12, §2.3.14).
test('VALUE=, VOL= and TABLE sources have two pins and POLY(n) 2 + 2n', () => {
  const [e1, e2, g1, g2] = parts('E1 1 0 VALUE={V(3)*2}\nE2 1 0 VOL={V(3)}\nG1 1 0 TABLE {V(a)} = (0,0) (1,1)\nG2 1 0 POLY(2) 3 0 4 0 0 1 1');
  assert.deepEqual([pins(e1).join(' '), pins(e2).join(' '), pins(g1).join(' '), pins(g2).join(' ')], ['n+=1 n-=0', 'n+=1 n-=0', 'n+=1 n-=0', 'n+=1 n-=0 nc1+=3 nc1-=0 nc2+=4 nc2-=0']);
});

// 10. Includes: `.INCL` and quoted names; `.LIB file entry` only (RG §2.1.15–16; disagreement 15).
test('.INCL "file" and .INC \'file\' are read; .LIB file entry reads a section; .LIB file alone is an error', () => {
  const found = parts('.INCL "models.inc"\n.inc \'sub.inc\'\n.LIB "cmos.lib" tt\nM1 d g s b nch\nX1 a b amp\nD1 a 0 dm', {
    'models.inc': '.MODEL dm D\n',
    'sub.inc': '.SUBCKT amp in out\nR1 in out 1k\n.ENDS amp\n',
    'cmos.lib': '.LIB tt\n.MODEL nch NMOS LEVEL=9\n.ENDL tt\n.LIB ff\n.MODEL nch PMOS\n.ENDL ff\n'
  });
  assert.deepEqual(found.map((part) => [part.ref, part.kind, pins(part).join(' ')]), [['M1', 'nmos', 'D=d G=g S=s B=b'], ['X1', 'block', 'in=a out=b'], ['D1', 'diode', '+=a -=0']]);
  assert.equal(error('.LIB "cmos.lib"\nR1 a 0 1k', { 'cmos.lib': '.MODEL nch NMOS\n' }).message, '.lib "cmos.lib" needs a section name, e.g. .lib "cmos.lib" tt; xyce reads a library only by section.');
});

test('includeReferences lists every .INC, .INCL, .INCLUDE and .LIB file a Xyce netlist names, unquoted, and skips a section definition', () => {
  assert.deepEqual(includeReferences('.INCL "models.inc"\n.inc sub.inc ; comment\n.LIB \'cmos.lib\' tt\n.LIB local\n.ENDL local\n  .INCLUDE indented.inc\n* .INC nope.inc', '', 'xyce'), ['models.inc', 'sub.inc', 'cmos.lib']);
});

// 11. Nested `.SUBCKT` definitions close at their own `.ENDS` (RG §2.1.37).
test('a nested .SUBCKT ends at its matching .ENDS, so the outer body stays out of the top level', () => {
  const { parts: found, notes } = netlist('X1 a b outer\n.SUBCKT outer p q\n.SUBCKT inner r\nR1 r 0 1k\n.ENDS inner\nXI p inner\nR2 p q 1k\n.ENDS outer');
  assert.deepEqual(found.map((part) => [part.ref, part.title, pins(part).join(' ')]), [['X1', 'outer', 'p=a q=b']]);
  assert.deepEqual(notes, []);
});

// 12. Only the first circuit of a file is drawn (ADR 0006; #1195).
test('the first .END ends the netlist with a note for what follows', () => {
  const { parts: found, notes } = netlist('R1 a 0 1k\n.END\n* second\nR2 a 0 1k\n.END');
  assert.deepEqual([found.map((part) => part.ref), notes], [['R1'], ['Line 2: 2 lines after .end are not read.']]);
});

// --- Decks in the shape of the Reference Guide's examples (test/fixtures/xyce/, written for this project) ----

const CORPUS = join('test', 'fixtures', 'xyce');

/** What each deck must read as: the parts drawn, and the notes left. */
const DECKS: Record<string, { parts: string[]; notes: string[] }> = {
  'mixed-signal.cir': {
    parts: ['VDD:vsource', 'VIN:vsource', 'RIN:resistor', 'X1:block', 'X2:block', 'M3:nmos', 'Q1:pnp', 'U1:block', 'UINV:block', 'S1:block', 'P1:block'],
    notes: ['Line 37: 1 line after .end is not read.', 'Line 24: the substrate connection of Q1 is not drawn.']
  },
  'y-devices.cir': {
    parts: [
      'VS:vsource', 'RS:resistor', 'mr1:block', 'dly1:block', 'line1:block', 'pde1:block', 'lin1:block', 'acc1:block', 'op1:block', 'gate1:block',
      'L1:inductor', 'L2:inductor', 'L3:inductor', 'RL:resistor', 'E1:block', 'G1:block', 'B1:block'
    ],
    notes: ['Line 16: mutual inductance K1 (L1 L2 L3 0.9 core) is not drawn.']
  }
};

test('every fixture deck is listed, and each reads into the expected parts and notes', () => {
  assert.deepEqual(readdirSync(CORPUS).filter((name) => name.endsWith('.cir')).sort(), Object.keys(DECKS).sort());
  for (const [name, expected] of Object.entries(DECKS)) {
    const { parts: found, notes } = netlist(readFileSync(join(CORPUS, name), 'utf8'));
    assert.deepEqual(found.map((part) => `${part.ref}:${part.kind}`), expected.parts, name);
    assert.deepEqual(notes, expected.notes, name);
  }
});

test('the mixed-signal deck: indented lines dropped, REPLACEGROUND, a global node, nested subcircuits, a three-node MVS, [SUB], gates, the generic switch and a port', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'mixed-signal.cir'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual([pins(by('VIN')), pins(by('RIN')), by('RIN').value], [['+=in', '-=0'], ['A=in', 'B=0'], 'rmod 1k']);
  assert.deepEqual([by('X1').title, pins(by('X1')), by('X1').value], ['INV', ['IN=in', 'OUT=out1'], 'PARAMS: W=2u']);
  assert.deepEqual(pins(by('M3')), ['D=out2', 'G=out1', 'S=0']);
  assert.deepEqual([pins(by('Q1')), by('Q1').value], [['C=$gvdd', 'B=out2', 'E=vout', 'S=sub'], 'qpnp 2']);
  assert.deepEqual([by('U1').title, pins(by('U1'))], ['AND(2)', ['DPWR=$gvdd', 'DGND=0', 'in1=out1', 'in2=out2', 'out=y']]);
  assert.deepEqual([by('UINV').title, pins(by('UINV'))], ['NOT', ['DPWR=$gvdd', 'DGND=0', 'in=y', 'out=yb']]);
  assert.deepEqual([pins(by('S1')), by('S1').value], [['n+=vout', 'n-=0'], 'swi OFF CONTROL={V(y) - 0.5}']);
  assert.deepEqual(pins(by('P1')), ['+=yb', '-=0']);
});

test('the Y-devices deck: every Y device by its catalogue entry or as a titled block, a multi-inductor K noted, and the dependent-source shapes', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'y-devices.cir'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual(found.filter((part) => part.kind === 'block').map((part) => part.title), [
    'memristor', 'delay', 'lumped line', 'PDE', 'n-port', 'ACC', 'OPAMP', 'AND', 'VCVS', 'VCCS', 'B source'
  ]);
  assert.deepEqual(pins(by('dly1')), ['out+=dout', 'out-=0', 'in+=mem', 'in-=0']);
  assert.deepEqual(pins(by('lin1')), ['1=pout', '2=0', '3=lout', '4=0']);
  assert.deepEqual([pins(by('gate1')), by('gate1').value], [['1=oout', '2=mem', '3=dout', '4=dgmod'], ''], 'the deprecated Y gate form is the fallback block: its model is read as a node');
  assert.deepEqual([pins(by('RL')), by('RL').value], [['A=n2', 'B=0'], 'R={100 * 2}']);
  assert.deepEqual([pins(by('E1')), pins(by('G1')).length, pins(by('B1'))], [['n+=e1', 'n-=0'], 6, ['+=b1', '-=0']]);
});
