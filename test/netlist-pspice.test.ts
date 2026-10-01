/**
 * What the reader makes of PSpice netlists read through the generated PSpice parser: one case
 * per finding of the PSpice research (Redmine #1186) that changes what is drawn, resolved by the
 * catalogue (#1192, #1197) and the dialect decisions (no title line, ADR 0006; the first `.end`
 * ends the netlist, #1195). `test/parser-pspice.test.ts` says how the lines are cut into tokens.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { includeReferences, parseNetlist, type IncludeSet, type Netlist, type Part } from '../src/netlist';
import { loadPspice } from './helpers/pspice';

before(loadPspice);

function netlist(source: string, files: IncludeSet['files'] = {}): Netlist {
  const result = parseNetlist(source, { files }, 'pspice');
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function parts(source: string, files?: IncludeSet['files']): Part[] {
  return netlist(source, files).parts;
}

function error(source: string, files: IncludeSet['files'] = {}) {
  const result = parseNetlist(source, { files }, 'pspice');
  if (result.ok) assert.fail('expected an error');
  return result;
}

/** A part's pins as `name=node` strings. */
function pins(part: Part | undefined): string[] {
  return (part?.pins ?? []).map((pin) => `${pin.name}=${pin.node}`);
}

// 1. `$` is not a comment: `$G_…` and `$D_…` nodes survive, and `$` text after a blank is value.
test('$G_ and $D_ nodes are kept, and a $ after a blank is not a comment', () => {
  const [r, c] = parts('R1 $G_DPWR out 1k $ note\nC1 out $D_HI 1n');
  assert.deepEqual(pins(r), ['A=$g_dpwr', 'B=out']);
  assert.equal(r!.value, '1k $ note');
  assert.deepEqual(pins(c), ['A=out', 'B=$d_hi']);
});

// 2. `//` is text; a `#` line is a comment.
test('// is not a comment and # starts a comment line', () => {
  assert.equal(parts('R1 a b 3k//x')[0]!.value, '3k//x');
  assert.match(error('R1 a b 1k\n// comment').message, /"\/\/" is not an element name/);
  assert.deepEqual(parts('# PSpice comment\nR1 a b 1k').map((part) => part.ref), ['R1']);
});

// 3. B, Z, N and O are PSpice's devices, not ngspice's (disagreements 3–6).
test('B is a GaAsFET, Z an IGBT, N a digital input and O a digital output, all blocks', () => {
  const [b, z, n, o] = parts('B1 d g s GMOD\nZ1 c g e IGBT1\nN1 a 0 vcc DIN DGTLNET=q IO_STD\nO1 a 0 DOUT DGTLNET=fq IO_STD\n.MODEL GMOD GASFET\n.MODEL IGBT1 NIGBT');
  assert.deepEqual([b!.type, b!.kind, b!.title, pins(b).join(' '), b!.value], ['gaasfet', 'block', 'GaAsFET', 'D=d G=g S=s', 'GMOD']);
  assert.deepEqual([z!.type, z!.title, pins(z).join(' ')], ['igbt', 'IGBT (N)', 'C=c G=g E=e']);
  assert.deepEqual([n!.type, n!.title, pins(n).join(' '), n!.value], ['digital-input', 'digital input', 'out=a low=0 high=vcc', 'DIN DGTLNET=q IO_STD']);
  assert.deepEqual([o!.type, o!.title, pins(o).join(' ')], ['digital-output', 'digital output', 'in=a ref=0']);
});

// 4. `U` is a digital primitive: two supply pins, then the signal pins the type and its numbers say (RG p.349–428).
test('U primitives take their supply pins and the signal pins their type says; the title is the type with its arguments', () => {
  const found = parts([
    'U1 NAND(2) $G_DPWR $G_DGND a b y D_00 IO_STD',
    'U2 JKFF(1) $G_DPWR $G_DGND 3 5 200 3 3 10 2 D_293ASTD IO_STD',
    'U3 NANDA(2,4) $G_DPWR $G_DGND i1 i2 i3 i4 i5 i6 i7 i8 o1 o2 o3 o4 D_00 IO_STD',
    'U4 PINDLY (1,0,0) $G_DPWR $G_DGND fq fqd IO_STD',
    'U5 STIM( 1, 1 ) $G_DPWR $G_DGND s IO_STM',
    'U6 INV $G_DPWR $G_DGND a y D_04 IO_STD'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.type, part.title, pins(part).join(' '), part.value]), [
    ['U1', 'digital-gate', 'NAND(2)', 'DPWR=$g_dpwr DGND=$g_dgnd in1=a in2=b out=y', 'NAND(2) D_00 IO_STD'],
    ['U2', 'digital-flip-flop', 'JKFF(1)', 'DPWR=$g_dpwr DGND=$g_dgnd PRE=3 CLR=5 CLK̅=200 J1=3 K1=3 Q1=10 Q̅1=2', 'JKFF(1) D_293ASTD IO_STD'],
    ['U3', 'digital-gate-array', 'NANDA(2,4)', 'DPWR=$g_dpwr DGND=$g_dgnd in1=i1 in2=i2 in3=i3 in4=i4 in5=i5 in6=i6 in7=i7 in8=i8 out1=o1 out2=o2 out3=o3 out4=o4', 'NANDA(2,4) D_00 IO_STD'],
    ['U4', 'digital-pin-delay', 'PINDLY(1,0,0)', 'DPWR=$g_dpwr DGND=$g_dgnd in1=fq out1=fqd', 'PINDLY (1,0,0) IO_STD'],
    ['U5', 'digital-stimulus', 'STIM(1,1)', 'DPWR=$g_dpwr DGND=$g_dgnd out1=s', 'STIM( 1, 1 ) IO_STM'],
    ['U6', 'digital-gate', 'INV', 'DPWR=$g_dpwr DGND=$g_dgnd in=a out=y', 'INV D_04 IO_STD']
  ]);
});

// 5. E and G have two output nodes in every form but the linear one (RG p.165–178, disagreement 9).
test('VALUE, TABLE, LAPLACE, FREQ, CHEBYSHEV, F= and Q= sources have two pins; POLY(n) has 2 + 2n, pairs written (a,b) included; the linear form four', () => {
  const found = parts([
    'E1 1 0 VALUE = {V(a)*2}',
    'E2 1 0 VALUE 2*V(a)',
    'E3 1 0 TABLE {V(a)} = (0,0) (1,1)',
    'E4 1 0 LAPLACE {V(a)} = {1/(1+s)}',
    'E5 1 0 FREQ {V(a)} = (0,0,0) (1k,-3,-45)',
    'E6 1 0 CHEBYSHEV {V(a)} = LP 800 1.2K .1dB 50dB',
    'E7 1 0 F = {V(a)}',
    'G1 1 0 Q = {V(a)}',
    'E8 1 0 POLY(1) (26,0) 0 500',
    'G2 1 0 POLY(2) a 0 b 0 0 1 1',
    'E9 1 0 a 0 10'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, pins(part).join(' ')]), [
    ['E1', 'n+=1 n-=0'],
    ['E2', 'n+=1 n-=0'],
    ['E3', 'n+=1 n-=0'],
    ['E4', 'n+=1 n-=0'],
    ['E5', 'n+=1 n-=0'],
    ['E6', 'n+=1 n-=0'],
    ['E7', 'n+=1 n-=0'],
    ['G1', 'n+=1 n-=0'],
    ['E8', 'n+=1 n-=0 nc1+=26 nc1-=0'],
    ['G2', 'n+=1 n-=0 nc1+=a nc1-=0 nc2+=b nc2-=0'],
    ['E9', 'n+=1 n-=0 nc+=a nc-=0']
  ]);
  assert.equal(found[8]!.value, 'POLY(1) 0 500', 'the unwrapped pair is nodes, not value');
});

// 6. `OPTIONAL:` pins may be left off a call from the right (RG p.105–108, disagreement 14).
test('a call may give none, some or all of a subcircuit\'s OPTIONAL: pins; PARAMS: and TEXT: end its nodes', () => {
  const sub = '.SUBCKT 74LS00 A B Y OPTIONAL: DPWR=$G_DPWR DGND=$G_DGND PARAMS: MNTYMXDLY=0 IO_LEVEL=0\nU1 NAND(2) DPWR DGND A B Y D_00 IO_STD\n.ENDS';
  const [x1, x2, x3] = parts(`X1 IN1 IN2 OUT 74LS00\nX2 IN1 IN2 OUT MYPOWER MYGROUND 74LS00 PARAMS: MNTYMXDLY=2\nX3 IN1 IN2 OUT MYPOWER 74LS00 TEXT: F="a b"\n${sub}`);
  assert.deepEqual(pins(x1), ['A=in1', 'B=in2', 'Y=out']);
  assert.deepEqual(pins(x2), ['A=in1', 'B=in2', 'Y=out', 'DPWR=mypower', 'DGND=myground']);
  assert.deepEqual([pins(x3).join(' '), x3!.value], ['A=in1 B=in2 Y=out DPWR=mypower', 'TEXT: F="a b"']);
  assert.equal(error(`X4 IN1 IN2 74LS00\n${sub}`).message, 'X4 connects 2 nodes, but subcircuit 74LS00 has 3 to 5 ports.');
  assert.equal(error(`X5 a b c d e f 74LS00\n${sub}`).message, 'X5 connects 6 nodes, but subcircuit 74LS00 has 3 to 5 ports.');
  assert.equal(error('X6 a b amp\n.subckt amp in out vcc\n.ends').message, 'X6 connects 2 nodes, but subcircuit amp has 3 ports.', 'unchanged without optional pins');
});

// 7. `.LIB file` reads a whole library; a bare `.LIB` means nom.lib; there are no sections (RG p.51, disagreement 10).
test('.LIB file reads the library\'s models and subcircuits, not its top-level elements; a missing library and a bare .LIB are notes', () => {
  const { parts: found, notes } = netlist('.LIB "models.lib"\n.LIB nom.lib\n.LIB\nQ1 c b e Q2N2222\nX1 in out OPA\nD1 a k D1N4148', {
    'models.lib': '.MODEL Q2N2222 NPN(BF=200)\nR9 x 0 1k\n.SUBCKT OPA in out\nR1 in out 1k\n.ENDS\n.MODEL D1N4148 D(IS=1n)'
  });
  assert.deepEqual(found.map((part) => [part.ref, part.kind]), [['Q1', 'npn'], ['X1', 'block'], ['D1', 'diode']]);
  assert.deepEqual(notes, [
    'Line 1: 1 element at the top level of models.lib is not part of the circuit; a PSpice library holds only models, subcircuits, parameters and functions.',
    'Line 2: .lib nom.lib is not read: the file is not here. PSpice reads it from its library path.',
    'Line 3: .lib without a file name is not read: it names nom.lib, which PSpice reads from its library path.'
  ]);
  assert.equal(error('.INC standard.lib\nR1 a 0 1k').message, 'standard.lib could not be read.', '.INC of a missing file is still an error');
});

test('a one-argument .LIB followed by .ENDL is still a whole file in PSpice, never a section', () => {
  // ngspice would read `.lib local` … `.endl` as a section definition; PSpice has no sections.
  const { parts: found, notes } = netlist('.LIB "x.lib"\n.ENDL\nQ1 c b e Q\n.MODEL Q PNP', { 'x.lib': '.MODEL D D' });
  assert.deepEqual([found[0]!.kind, notes], ['pnp', []]);
});

test('includeReferences lists every .INC and .LIB file a PSpice netlist names, unquoted, and skips a bare .LIB', () => {
  assert.deepEqual(includeReferences('.LIB "my models.lib"\n.LIB nom.lib\n.LIB\n.INC "e_sources.net"\n* .INC nope.lib', '', 'pspice'), ['my models.lib', 'nom.lib', 'e_sources.net']);
});

// 8. `.MODEL name AKO:reference type` and the lateral PNP (RG p.58–62, disagreements 11 and 12).
test('an AKO: model takes the type written after its reference, and LPNP is drawn as PNP', () => {
  const [q1, q2, q3] = parts('Q1 c b e QDR2\nQ2 c b e QLAT\nQ3 c b e QSP\n.MODEL QDRIV PNP (BF=50)\n.MODEL QDR2 AKO:QDRIV PNP (BF=100)\n.MODEL QLAT LPNP (BF=40)\n.MODEL QSP AKO: QLAT LPNP');
  assert.deepEqual([q1!.kind, q2!.kind, q3!.kind], ['pnp', 'pnp', 'pnp']);
});

// 9. A named substrate is written in brackets; a fourth name is otherwise the model (RG p.272, disagreement 17).
test('[SUB] is the substrate node sub; an unbracketed fourth name is the model; a number is a substrate', () => {
  const { parts: found, notes } = netlist('Q1 c b e [SUB] QM\nQ2 c b e QM\nQ3 c b e 5 QM\nQ4 c b e QX\nR1 [sub] 0 1k\n.MODEL QM LPNP');
  assert.deepEqual(found.map((part) => [part.ref, part.kind, pins(part).join(' ')]), [
    ['Q1', 'pnp', 'C=c B=b E=e S=sub'],
    ['Q2', 'pnp', 'C=c B=b E=e'],
    ['Q3', 'pnp', 'C=c B=b E=e S=5'],
    ['Q4', 'npn', 'C=c B=b E=e'],
    ['R1', 'resistor', 'A=sub B=0']
  ]);
  assert.deepEqual(notes, [
    'Line 1: the substrate connection of Q1 is not drawn.',
    'Line 3: the substrate connection of Q3 is not drawn.',
    'Line 4: model QX of Q4 is not defined here; drawn as NPN.'
  ]);
});

// 10. Passives name their model before the value (disagreement 13); switches, lines and couplings as in ngspice.
test('R, C and L put the model before the value, which stays the value text; S, W and T are blocks', () => {
  const [r, c, l, s, w, t] = parts('R1 a b RMOD 10k TC=0,0\nC1 a 0 CMOD 1u IC=0\nL1 a 0 LMOD 1m\nS1 a b c 0 SMOD\nW1 a 0 V1 WMOD\nT1 a 0 b 0 LEN=0.1 R=0.05 L=1e-8 G=0 C=20e-12\n.MODEL RMOD RES R=1\n.MODEL CMOD CAP C=1\n.MODEL LMOD IND L=1\n.MODEL SMOD VSWITCH (RON=1)\n.MODEL WMOD ISWITCH (ION=1m)');
  assert.deepEqual([r!.kind, r!.value, c!.kind, c!.value, l!.kind, l!.value], ['resistor', 'RMOD 10k TC=0 0', 'capacitor', 'CMOD 1u IC=0', 'inductor', 'LMOD 1m']);
  assert.deepEqual([s!.type, pins(s).length, w!.type, pins(w).length, t!.type, pins(t).length], ['vswitch', 4, 'iswitch', 2, 'lossless-line', 4]);
});

// 11. `.ALIASES` lines are not elements (disagreement 18).
test('.ALIASES … .ENDALIASES draws nothing', () => {
  assert.deepEqual(parts('R1 a 0 1k\n.ALIASES\nR_RBIAS RBIAS (1=$N_0001 2=VDD)\n_ _ (OUT=$N_0007)\n.ENDALIASES').map((part) => part.ref), ['R1']);
});

// 12. Several circuits in one file: only the first is drawn, with a note (disagreement 16); GND stays ground (unconfirmed, kept).
test('the first .END ends the netlist with a note for the second circuit, and GND is still ground', () => {
  const { parts: found, notes } = netlist('R1 a GND 1k\n.END\n* second\nSecond circuit\nR2 a 0 1k\n.END');
  assert.deepEqual([found.map((part) => part.ref), pins(found[0])], [['R1'], ['A=a', 'B=0']]);
  assert.deepEqual(notes, ['Line 2: 3 lines after .end are not read.']);
});

// --- Decks in the shape Capture exports (test/fixtures/pspice/, written for this project) ---------------

const CORPUS = join('test', 'fixtures', 'pspice');

/** What each deck must read as: the parts drawn, and the notes left. */
const DECKS: Record<string, { parts: string[]; notes: string[] }> = {
  'nand-latch.cir': {
    parts: ['V_VCC:vsource', 'R_R1:resistor', 'X_U1A:block', 'X_U1B:block', 'U_SET:block', 'U_RST:block', 'U_FF:block', 'N_IN:block', 'O_OUT:block', 'U_DLY:block'],
    notes: [
      'Line 5: .lib 74LS.lib is not read: the file is not here. PSpice reads it from its library path.',
      'Line 6: .lib without a file name is not read: it names nom.lib, which PSpice reads from its library path.'
    ]
  },
  'abm-regulator.cir': {
    parts: [
      'V_VIN:vsource', 'R_R1:resistor', 'R_R2:resistor', 'E_ERR:block', 'E_FILT:block', 'G_LOAD:block', 'E_SUM:block', 'F_SENSE:block', 'H_MON:block',
      'E_FLUX:block', 'Q_PASS:pnp', 'Q_DRV:npn', 'B_GAAS:block', 'Z_IGBT:block', 'S_SW:block', 'W_SW:block', 'T_LINE:block', 'C_OUT:capacitor'
    ],
    notes: [
      'Line 39: 3 lines after .end are not read.',
      'Line 7: .lib regulator_models.lib is not read: the file is not here. PSpice reads it from its library path.',
      'Line 19: the substrate connection of Q_PASS is not drawn.'
    ]
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

test('the NAND latch deck: optional pins given or left off, a JK flip-flop with seven signal pins, stimuli over continuation lines', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'nand-latch.cir'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual(pins(by('X_U1A')), ['A=set', 'B=q', 'Y=qb']);
  assert.deepEqual(pins(by('X_U1B')), ['A=qb', 'B=rst', 'Y=q', 'DPWR=$g_dpwr', 'DGND=$g_dgnd']);
  assert.equal(by('X_U1B').value, 'PARAMS: MNTYMXDLY=2 IO_LEVEL=1');
  assert.deepEqual(pins(by('U_FF')), ['DPWR=$g_dpwr', 'DGND=$g_dgnd', 'PRE=$d_hi', 'CLR=$d_hi', 'CLK̅=clk', 'J1=q', 'K1=qb', 'Q1=fq', 'Q̅1=fqb']);
  assert.deepEqual([by('U_SET').title, by('U_SET').value], ['STIM(1,1)', 'STIM(1,1) IO_STM 0s 1 10ns 0 20ns 1']);
  assert.deepEqual([by('U_DLY').title, pins(by('U_DLY')).slice(2)], ['PINDLY(1,0,0)', ['in1=fq', 'out1=fq_d']]);
});

test('the ABM regulator deck: every dependent-source shape, the AKO: lateral PNP with its bracketed substrate, and the PSpice-only devices', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'abm-regulator.cir'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual(['E_ERR', 'E_FILT', 'G_LOAD', 'E_FLUX', 'F_SENSE', 'H_MON'].map((ref) => pins(by(ref)).length), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(pins(by('E_SUM')), ['n+=sum', 'n-=0', 'nc1+=filt', 'nc1-=0', 'nc2+=fb', 'nc2-=0']);
  assert.deepEqual(pins(by('Q_PASS')), ['C=out', 'B=err', 'E=in', 'S=sub']);
  assert.deepEqual([by('B_GAAS').title, by('Z_IGBT').title, by('T_LINE').title], ['GaAsFET', 'IGBT (N)', 'line']);
  assert.equal(by('R_R1').value, 'RMOD 10k TC=0 0', 'the comma is a separator, as in every SPICE dialect');
});
