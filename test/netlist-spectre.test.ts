/**
 * What the reader makes of Spectre netlists read through the generated Spectre parsers — native
 * Spectre and its SPICE mode, switched by `simulator lang=` — one case per finding of the Spectre
 * research (Redmine #1189) that changes what is drawn, resolved by the catalogue keyed by master
 * (#1192, #1197) and the dialect decisions (a fence starts in Spectre with no title line, #1195).
 * `test/parser-spectre.test.ts` says how the lines are cut into tokens.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { includeReferences, parseNetlist, type IncludeSet, type Netlist, type Part } from '../src/netlist';
import { loadSpectre } from './helpers/spectre';

before(loadSpectre);

function netlist(source: string, files: IncludeSet['files'] = {}): Netlist {
  const result = parseNetlist(source, { files }, 'spectre');
  if (!result.ok) assert.fail(`unexpected error: ${result.message} at ${result.line}:${result.column}`);
  return result.netlist;
}

function parts(source: string, files?: IncludeSet['files']): Part[] {
  return netlist(source, files).parts;
}

function error(source: string, files: IncludeSet['files'] = {}) {
  const result = parseNetlist(source, { files }, 'spectre');
  if (result.ok) assert.fail('expected an error');
  return result;
}

/** A part's pins as `name=node` strings. */
function pins(part: Part | undefined): string[] {
  return (part?.pins ?? []).map((pin) => `${pin.name}=${pin.node}`);
}

// 1. The master names the type (UG p.30, 63): a primitive directly, or through the model it names.
test('primitives are drawn by their master: resistor, capacitor, inductor, vsource, isource, diode; a resistor may add a bulk node', () => {
  const found = parts('r1 (in out) resistor r=10k\nc1 (out 0) capacitor c=1p\nl1 (in 0) inductor l=1u\nv1 (in 0) vsource dc=5\ni1 (0 out) isource dc=1m\nd1 (out 0) diode\nr2 (in out sub) resistor r=1 m=2');
  assert.deepEqual(found.map((part) => [part.ref, part.type, part.kind, pins(part).join(' '), part.value]), [
    ['r1', 'resistor', 'resistor', 'A=in B=out', 'r=10k'],
    ['c1', 'capacitor', 'capacitor', 'A=out B=0', 'c=1p'],
    ['l1', 'inductor', 'inductor', 'A=in B=0', 'l=1u'],
    ['v1', 'vsource', 'vsource', '+=in -=0', 'dc=5'],
    ['i1', 'isource', 'isource', '+=0 -=out', 'dc=1m'],
    ['d1', 'diode', 'diode', '+=out -=0', ''],
    ['r2', 'resistor', 'resistor', 'A=in B=out bulk=sub', 'r=1 m=2']
  ]);
  assert.deepEqual(netlist('r2 (in out sub) resistor r=1').notes, ['Line 1: the bulk connection of r2 is not drawn.']);
});

test('a model statement names the master, and its type= parameter decides NPN or PNP, N or P; so does type= on the instance itself', () => {
  const [q1, q2, q3, m1, m2, m3, m4] = parts([
    'Q1 (c b e) npn', 'Q2 (c b e) pnpm area=2', 'Q3 (c b e) bjt type=pnp',
    'M1 (d g s b) nch w=1u', 'M2 (d g s b) pch', 'M3 (d g s b) bsim4 type=p', 'M4 (d g s b) bsim4',
    'model npn bjt type=npn bf=80', 'model pnpm bjt', '+ type=pnp', 'model nch bsim4 type=n', 'model pch bsim4 type=p tox=1e-9'
  ].join('\n'));
  assert.deepEqual([q1!.kind, q1!.value, q2!.kind, q2!.value, q3!.kind, q3!.value], ['npn', 'npn', 'pnp', 'pnpm area=2', 'pnp', 'type=pnp']);
  assert.deepEqual([m1!.kind, pins(m1).join(' '), m1!.value, m2!.kind, m3!.kind, m4!.kind], ['nmos', 'D=d G=g S=s B=b', 'nch w=1u', 'pmos', 'pmos', 'nmos']);
});

test('a bsimsoi takes four to seven nodes, vbic up to six, with the extra ones noted; too few or too many nodes are errors', () => {
  const { parts: found, notes } = netlist('p1 (out in vdd 0) pfet w=1e-6\nn1 (out in 0 0 0) nfet\nq1 (c b e s dt) vbic\nmodel nfet bsimsoi\n+type = n\nmodel pfet bsimsoi\n+type = p');
  assert.deepEqual(found.map((part) => [part.type, part.kind, pins(part).join(' ')]), [
    ['soi-mosfet', 'pmos', 'D=out G=in S=vdd B=0'],
    ['soi-mosfet', 'nmos', 'D=out G=in S=0 B=0 P=0'],
    ['bjt', 'npn', 'C=c B=b E=e S=s tj=dt']
  ]);
  assert.deepEqual(notes, ['Line 2: the body contact connection of n1 is not drawn.', 'Line 3: the substrate connection of q1 is not drawn.', 'Line 3: the thermal connection of q1 is not drawn.']);
  assert.equal(error('global 0\nr1 (a) resistor r=1').message, 'r1 needs 2 nodes; found 1.');
  assert.equal(error('global 0\nr1 (a b c d) resistor r=1').message, 'r1 connects 4 nodes, but a resistor has at most 3.');
  assert.equal(error('global 0\nr1 a resistor r=1').message, 'r1 needs 2 nodes; found 1.');
});

// 2. Names are case-sensitive (UG p.49, 59): instances, nodes and models.
test('instances, nodes and models keep their case: r0 and R0 are two parts, V2 and v2 two nodes, NCH and nch two models', () => {
  const found = parts('V0 (net1 0) vsource dc=1\nr0 (net4 V2) resistor r=1K\nR0 (net1 v2) resistor r=1K\nm1 (d g s b) NCH\nm2 (d g s b) nch\nmodel NCH bsim4 type=p\nmodel nch bsim4 type=n');
  assert.deepEqual(found.map((part) => [part.ref, pins(part)[1], part.kind]), [['V0', '-=0', 'vsource'], ['r0', 'B=V2', 'resistor'], ['R0', 'B=v2', 'resistor'], ['m1', 'G=g', 'pmos'], ['m2', 'G=g', 'nmos']]);
});

// 3. Ground is `0`, or the first name of the first `global` statement (Reference 19.1 p.482); `gnd` alone is a node.
test('0 is ground; gnd is an ordinary node unless a global statement names it first; global 0 changes nothing', () => {
  assert.deepEqual(parts('r1 (a gnd) resistor r=1\nr2 (a 0) resistor r=1').map((part) => pins(part)[1]), ['B=gnd', 'B=0']);
  assert.deepEqual(parts('global gnd vdd!\nr1 (a gnd) resistor r=1\nr2 (vdd! 0) resistor r=1\nglobal vdd!').map((part) => pins(part)), [['A=a', 'B=0'], ['A=vdd!', 'B=0']]);
  assert.deepEqual(parts('global 0\nr1 (a gnd) resistor r=1').map((part) => pins(part)[1]), ['B=gnd']);
});

// 4. Analyses and control statements look like instances (UG p.31) and are skipped by their master; keyword statements are skipped too.
test('analyses, options, info, save, ic, parameters and the simulator line draw nothing and leave no note', () => {
  const { parts: found, notes } = netlist([
    'simulator lang=spectre', 'global 0', 'parameters rb=10k', 'r1 (a 0) resistor r=rb', 'ic a=5', 'nodeset a=5', 'save a',
    'tran tran stop=80us maxstep=10ns', 'noise1 (a 0) noise start=1 stop=1G', 'simulatorOptions options reltol=1e-3', 'finalTimeOP info what=oppoint where=rawfile',
    'mysweep dc dev=v1 start=0 stop=10 step=1', 'sppSaveOptions options save=allpub', 'alt1 alter param=temp value=50', 'ps1 paramset {', '1 2', '}'
  ].join('\n'));
  assert.deepEqual([found.map((part) => part.ref), notes], [['r1'], []]);
});

// 5. Subcircuits (UG p.94–100): `subckt name (ports)` or bare ports, `inline subckt`, `ends [name]`; any unknown master is a subcircuit or module.
test('a subckt instance is a block titled by its master with the definition\'s ports; an inline subckt likewise; an unknown master has numbered pins and a note', () => {
  const { parts: found, notes } = netlist([
    'subckt RC_sub (in out)', 'parameters rval=1K', 'R1 (in mid) resistor r=rval', 'C1 (mid out) capacitor c=1u', 'ends RC_sub',
    'subckt R_subckt Vnode1_I2 P2', 'R1 (Vnode1_I2 P2) resistor r=5K', 'ends R_subckt',
    'inline subckt pch_mac (d g s b)', 'pch_mac (d g s b) bsim4 type=p', 'ends pch_mac',
    'X1 (net5 net6) RC_sub rval=2K', 'I2 (Vnode1 0) R_subckt', 'M2 (vdd b 0 0) pch_mac w=1u', 'Amp1 (b1 b2 out) opamp_x gain=1e3'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.kind, part.title, pins(part).join(' '), part.value]), [
    ['X1', 'block', 'RC_sub', 'in=net5 out=net6', 'rval=2K'],
    ['I2', 'block', 'R_subckt', 'Vnode1_I2=Vnode1 P2=0', ''],
    ['M2', 'block', 'pch_mac', 'd=vdd g=b s=0 b=0', 'w=1u'],
    ['Amp1', 'block', 'opamp_x', '1=b1 2=b2 3=out', 'gain=1e3']
  ]);
  assert.deepEqual(notes, ['Line 15: subcircuit opamp_x of Amp1 is not defined here; its pins are numbered.']);
  assert.equal(error('subckt s (a b)\nends s\nx1 (a) s').message, 'x1 connects 1 nodes, but subcircuit s has 2 ports.');
  assert.equal(error('subckt s (a b)\nr1 (a b) resistor r=1').message, 'subckt has no matching ends.');
});

// 6. Dependent sources and the Spectre-only masters (REF03): node counts from the catalogue.
test('vccs with two node groups, vcvs, cccs with probe=, iprobe, port, transformer, switch, nport, tline, relay and mutual_inductor', () => {
  const { parts: found, notes } = netlist([
    'Gm (1 2)(3 4) vccs gm=.01', 'e1 (p n ps ns) vcvs gain=2', 'f1 (1 2) cccs probe=v1 gain=1', 'h1 (1 2) pccvs probe=v1 coeffs=[0 1]',
    'ip (in out) iprobe', 'p1 (in 0) port num=1 r=50', 't1 (a b c d) transformer n1=1 n2=2', 'sw (a b c) switch position=1',
    'n1 (t1 b1 t2 b2) nport file="x.s2p"', 'tl (a 0 b 0) tline z0=50', 'rl (a b c d) relay vt1=1', 'ml1 mutual_inductor coupling=0.9 ind1=l1 ind2=l2'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.title, pins(part).join(' ')]), [
    ['Gm', 'VCCS', 'n+=1 n-=2 nc+=3 nc-=4'],
    ['e1', 'VCVS', 'n+=p n-=n nc+=ps nc-=ns'],
    ['f1', 'CCCS', '+=1 -=2'],
    ['h1', 'CCVS', '+=1 -=2'],
    ['ip', 'ammeter', 'in=in out=out'],
    ['p1', 'port', '+=in -=0'],
    ['t1', 'transformer', 't1=a b1=b t2=c b2=d'],
    ['sw', 'switch', '1=a 2=b 3=c'],
    ['n1', 'n-port', '1=t1 2=b1 3=t2 4=b2'],
    ['tl', 'line', 'A+=a A-=0 B+=b B-=0'],
    ['rl', 'switch', 'n+=a n-=b nc+=c nc-=d']
  ]);
  assert.deepEqual(notes, ['Line 12: mutual inductance ml1 (coupling=0.9 ind1=l1 ind2=l2) is not drawn.']);
});

// 7. Blocks (UG p.70, 110, 167): `if … { } else { }` reads the first branch; sweep and montecarlo blocks are read through; statistics is skipped.
test('an if block draws its first branch and skips the else branch with a note; instances inside a sweep block are read; a statistics block is skipped', () => {
  const { parts: found, notes } = netlist([
    'if (rval > 1k) {', '  Rsel (Out 0) resistor r=rval', '} else {', '  Rsel (Out 0) resistor r=1', '}',
    'if (x)', '{', 'r2 (a 0) resistor r=2', '}', 'else', '{', 'r2 (a 0) resistor r=3', '}',
    'swp sweep param=temp values=[25 75 100] {', '  op1 dc', '  r3 (a 0) resistor r=3', '}',
    'statistics {', ' process { vary d1 dist=gauss std=1 }', '}', 'r4 (a 0) resistor r=4'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.value]), [['Rsel', 'r=rval'], ['r2', 'r=2'], ['r3', 'r=3'], ['r4', 'r=4']]);
  assert.deepEqual(notes, ['Line 1: if is not evaluated; its first branch is drawn and the else branch is skipped.', 'Line 6: if is not evaluated; its first branch is drawn and the else branch is skipped.']);
  assert.equal(error('r1 (a 0) resistor r=1\n}').message, '} has no matching {.');
  assert.equal(error('swp sweep param=temp {\nr1 (a 0) resistor r=1').message, '{ has no matching }.');
});

// 8. Includes (UG p.72–76; Reference 19.1 p.493, 498): `include "f" [section=s]`, `#include`, `ahdl_include`; a `.scs` file starts in Spectre, any other in SPICE mode.
test('include reads a .scs file in Spectre, a section of a library, and any other file in SPICE mode; #include likewise; ahdl_include is noted', () => {
  const { parts: found, notes } = netlist('include "models.scs"\ninclude "lib.scs" section=tt\n#include "stage.scs"\ninclude "legacy.lib"\nahdl_include "va/amp.va"\nq1 (c b e) pnpm\nm1 (d g s b) nch\nx1 (c b) stage\nA1 (in out) amp', {
    'models.scs': 'model pnpm bjt type=pnp\n',
    'lib.scs': 'library mylib\nsection tt\nmodel nch bsim4 type=n\nendsection tt\nsection ff\nmodel nch bsim4 type=p\nendsection ff\nendlibrary mylib\n',
    'stage.scs': 'subckt stage (a b)\nr1 (a b) resistor r=1\nends stage\n',
    'legacy.lib': 'R9 c b 1k\n'
  });
  assert.deepEqual(found.map((part) => [part.ref, part.kind, part.title ?? pins(part).join(' ')]), [['R9', 'resistor', 'A=c B=b'], ['q1', 'pnp', 'C=c B=b E=e'], ['m1', 'nmos', 'D=d G=g S=s B=b'], ['x1', 'block', 'stage'], ['A1', 'block', 'amp']]);
  assert.deepEqual(notes, ['Line 5: ahdl_include va/amp.va is not read; its modules are drawn as blocks with numbered pins.', 'Line 9: subcircuit amp of A1 is not defined here; its pins are numbered.']);
  assert.equal(error('include "lib.scs" section=ss\nr1 (a 0) resistor r=1', { 'lib.scs': 'section tt\nendsection tt\n' }).message, 'lib.scs has no section ss.');
  assert.equal(error('include "none.scs"\nr1 (a 0) resistor r=1').message, 'none.scs could not be read.');
});

test('a section in an included library that nothing selected is skipped with a note, and includeReferences lists every include and #include', () => {
  const { notes } = netlist('include "lib.scs"\nr1 (a 0) resistor r=1', { 'lib.scs': 'library l\nsection tt\nmodel nch bsim4\nendsection tt\nendlibrary l\n' });
  assert.deepEqual(notes, ['Lib.scs line 2: section tt is not read; a library section is read only by include "file" section=name.']);
  assert.deepEqual(includeReferences('include "models.scs"\ninclude "lib.scs" section=tt\n#include "stage.scs"\nahdl_include "va/amp.va"\n// include "no.scs"\nsimulator lang=spice\n.include legacy.lib\n.lib "cmos.lib" tt', '', 'spectre'), ['models.scs', 'lib.scs', 'stage.scs', 'legacy.lib', 'cmos.lib']);
});

// 9. `simulator lang=` switches the language anywhere (UG p.53–54); SPICE-mode text folds case and reads by element letter.
test('a netlist may switch to SPICE mode and back, even inside a subckt; SPICE-mode names fold to lower case and a *spectre: line is read', () => {
  const { parts: found, notes } = netlist([
    'V1 (In 0) vsource dc=1', 'R1 (In Mid) resistor r=1k', 'X1 (Mid Out) rc_stage',
    'simulator lang=spice', 'C1 out 0 1u m=2', 'D1 OUT 0 dmod', '.model dmod d', '*spectre: Rload out 0 1k',
    '.subckt rc_stage in out', 'R1 in out 1k', 'simulator lang=spectre', 'C2 (out 0) capacitor c=1u', 'simulator lang=spice', '.ends rc_stage',
    'simulator lang=spectre', 'Rx (Out 0) resistor r=1'
  ].join('\n'));
  assert.deepEqual(found.map((part) => [part.ref, part.kind, pins(part).join(' ')]), [
    ['V1', 'vsource', '+=In -=0'], ['R1', 'resistor', 'A=In B=Mid'], ['X1', 'block', 'in=Mid out=Out'],
    ['C1', 'capacitor', 'A=out B=0'], ['D1', 'diode', '+=out -=0'], ['Rload', 'resistor', 'A=out B=0'], ['Rx', 'resistor', 'A=Out B=0']
  ]);
  assert.deepEqual(notes, []);
});

test('a .end in a SPICE-mode region ends the netlist, counting the lines after it in every later region', () => {
  const { parts: found, notes } = netlist('r1 (a 0) resistor r=1\nsimulator lang=spice\nR2 a 0 1k\n.end\nR3 a 0 1k\nsimulator lang=spectre\n// comment\nr4 (a 0) resistor r=1');
  assert.deepEqual([found.map((part) => part.ref), notes], [['r1', 'R2'], ['Line 4: 2 lines after .end are not read.']]);
});

// 10. Errors in Spectre wording.
test('a line that is no instance or statement is reported in Spectre\'s terms, and a SPICE-mode line in the SPICE dialects\' terms', () => {
  assert.equal(error('r1 (a 0) resistor r=1\n= 1').message, '"=" is not an instance or statement name. An instance is written name (nodes) master param=value, e.g. r1 (in out) resistor r=10k.');
  assert.equal(error('1abc (a 0) resistor r=1').message, '"1abc" is not an instance or statement name. An instance is written name (nodes) master param=value, e.g. r1 (in out) resistor r=10k. If this line is a title, start it with * to make it a comment.');
  assert.equal(error('simulator lang=spice\n1R a b 1k').message, '"1R" is not an element name. Element names start with a letter, e.g. R1.');
  assert.equal(error('global 0\nr1 (a 0) r=1').message, 'Unexpected parameter name "r"; expected word, master or node list.');
  assert.equal(error('r1 (a 0').message, 'The ( opened here is not closed. If this line is a title, start it with * to make it a comment.');
});

// --- Decks in the shape of the User Guide's examples (test/fixtures/spectre/, written for this project) ----

const CORPUS = join('test', 'fixtures', 'spectre');

/** What each deck must read as: the parts drawn, and the notes left. */
const DECKS: Record<string, { parts: string[]; notes: string[]; files: IncludeSet['files'] }> = {
  'oscillator.scs': {
    parts: [
      'Iee:isource', 'Vcc:vsource', 'Q1:npn', 'Q2:npn', 'Q3:pnp', 'L1:inductor', 'C1:capacitor', 'C2:capacitor', 'C3:capacitor', 'C4:capacitor',
      'R1:resistor', 'R2:resistor', 'Rsub:resistor', 'Gm:block', 'L2:inductor', 'M1:nmos', 'M2:block', 'Amp1:block'
    ],
    notes: [
      'Line 20: the bulk connection of Rsub is not drawn.',
      'Line 22: mutual inductance ml1 (coupling=0.9 ind1=L1 ind2=L2) is not drawn.',
      'Line 26: subcircuit opamp_x of Amp1 is not defined here; its pins are numbered.'
    ],
    files: { 'models.scs': 'model opamp_dummy vcvs\n', 'lib.scs': 'library l\nsection tt\nparameters tt=1\nendsection tt\nendlibrary l\n' }
  },
  'mixed-language.scs': {
    parts: ['V1:vsource', 'R1:resistor', 'X1:block', 'C1:capacitor', 'D1:diode', 'Rload:resistor', 'Rsel:resistor'],
    notes: ['Line 20: if is not evaluated; its first branch is drawn and the else branch is skipped.'],
    files: {}
  }
};

test('every fixture deck is listed, and each reads into the expected parts and notes', () => {
  assert.deepEqual(readdirSync(CORPUS).filter((name) => name.endsWith('.scs')).sort(), Object.keys(DECKS).sort());
  for (const [name, expected] of Object.entries(DECKS)) {
    const { parts: found, notes } = netlist(readFileSync(join(CORPUS, name), 'utf8'), expected.files);
    assert.deepEqual(found.map((part) => `${part.ref}:${part.kind}`), expected.parts, name);
    assert.deepEqual(notes, expected.notes, name);
  }
});

test('the oscillator deck: models by type=, bare nodes, two node groups, an inline subckt as a block, a continued model, and every analysis skipped', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'oscillator.scs'), 'utf8'), DECKS['oscillator.scs']!.files);
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual([pins(by('Q1')), by('Q1').value], [['C=cc', 'B=b1', 'E=e'], 'npn']);
  assert.deepEqual([pins(by('Q3')), by('Q3').value], [['C=vdd!', 'B=b2', 'E=out'], 'pnpm area=2']);
  assert.deepEqual([pins(by('R2')), by('R2').value], [['A=b2', 'B=0'], 'r=rb']);
  assert.deepEqual([by('Gm').title, pins(by('Gm'))], ['VCCS', ['n+=out', 'n-=0', 'nc+=b1', 'nc-=0']]);
  assert.deepEqual([pins(by('M1')), by('M1').value], [['D=vdd!', 'G=b1', 'S=0', 'B=0'], 'nch w=1u l=0.1u']);
  assert.deepEqual([by('M2').title, pins(by('M2')), by('M2').value], ['pch_mac', ['d=vdd!', 'g=b2', 's=0', 'b=0'], 'w=1u l=0.1u']);
  assert.deepEqual(pins(by('Amp1')), ['1=b1', '2=b2', '3=out']);
});

test('the mixed-language deck: SPICE-mode elements beside Spectre instances, a subckt spanning a switch, a *spectre: line, and the first if branch', () => {
  const { parts: found } = netlist(readFileSync(join(CORPUS, 'mixed-language.scs'), 'utf8'));
  const by = (ref: string) => found.find((part) => part.ref === ref)!;
  assert.deepEqual([by('X1').title, pins(by('X1')), by('X1').value], ['rc_stage', ['in=Mid', 'out=Out'], 'rval=2K']);
  assert.deepEqual([pins(by('C1')), by('C1').value], [['A=out', 'B=0'], '1u m=2']);
  assert.deepEqual([pins(by('D1')), by('D1').value], [['+=out', '-=0'], 'dmod']);
  assert.deepEqual([pins(by('Rload')), by('Rload').value], [['A=out', 'B=0'], '1k']);
  assert.deepEqual([pins(by('Rsel')), by('Rsel').value], [['A=Out', 'B=0'], 'r=rval']);
});

// 12. `global` names after the first (ground) are global nodes (#1197 rule 3), case kept.
test('the names on a global statement after the ground are the netlist\'s global nodes', () => {
  assert.deepEqual(netlist('global 0 vdd! Vss\nr1 (vdd! a) resistor r=1').globals, ['vdd!', 'Vss']);
});
