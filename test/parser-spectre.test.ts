/**
 * The vendored Spectre module — the second base grammar — against what Spectre reads, one case per
 * finding of the Spectre research (Redmine #1189) that changes how a line is cut into tokens, and
 * the `spectre-spice` module for its SPICE mode. The modules only classify (ADR 0008): these tests
 * say which cards and tokens a line becomes, never what is drawn — `test/netlist-spectre.test.ts`
 * does that.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, ParserOutput, Token } from '../src/parser/contract';
import { parse } from '../src/parser/registry';
import { checkDocument } from './helpers/parser-output';
import { loadSpectre } from './helpers/spectre';

before(loadSpectre);

/** Parse, check the contract, and return the document. */
function read(text: string, language: 'spectre' | 'spectre-spice' = 'spectre'): ParserOutput {
  const output = parse(language, text);
  checkDocument(output, text, JSON.stringify(text));
  return output;
}

/** The cards of a well-formed netlist, compactly: `r1:resistor( in out P:r=1k`, `model npn bjt P:type=npn`, `R1:R a b 1k`. */
function cards(text: string, language: 'spectre' | 'spectre-spice' = 'spectre'): string[] {
  const output = read(text, language);
  assert.equal(output.error, undefined, `${JSON.stringify(text)}: ${JSON.stringify(output.error)}`);
  return output.cards.map(compact);
}

function compact(card: Card): string {
  const head = card.kind === 'element' ? `${card.ref}:${card.master ?? card.letter}${card.nodesClosed ? '(' : ''}` : card.name;
  return [head, ...card.tokens.map(token)].join(' ');
}

function token(t: Token): string {
  switch (t.class) {
    case 'word': return t.text;
    case 'keyword': return `K:${t.text}`;
    case 'group': return `G:${t.text}`;
    case 'pair': return `P:${t.text}`;
  }
}

function error(text: string) {
  const output = read(text);
  assert.ok(output.error, `${JSON.stringify(text)}: expected an error`);
  return { ...output.error, cards: output.cards.map(compact) };
}

// --- Instances (UG p.29–30, 62–63): `name [(nodes)] master param=value …`, the master a card field ----

test('an instance names its master after a parenthesised node list, after bare nodes, or with no nodes at all', () => {
  assert.deepEqual(cards('r1 (in out) resistor r=10k\nR2 in out resistor r=10k m=2\nml1 mutual_inductor coupling=1 ind1=l1 ind2=l2\nQ1 (c b e) npn\nCoax1 pin nin out gnd coax zin=75\n'), [
    'r1:resistor( in out P:r=10k',
    'R2:resistor in out P:r=10k P:m=2',
    'ml1:mutual_inductor P:coupling=1 P:ind1=l1 P:ind2=l2',
    'Q1:npn( c b e',
    'Coax1:coax pin nin out gnd P:zin=75'
  ]);
  const first = read('r1 (in out) resistor r=10k\n').cards[0]!;
  assert.equal(first.kind === 'element' ? first.letter : 'directive', undefined, 'a Spectre card has a master and no letter');
});

test('a controlled source may write two node groups, the parentheses may hold blanks, and a group after the master is a parameter group', () => {
  assert.deepEqual(cards('Gm (1 2)(3 4) vccs gm=.01\nm1 ( 1 2 0 0 ) nch\nR7 (x y) rmod (r=1k w=2u)\nx1 () empty\n'), [
    'Gm:vccs( 1 2 3 4 P:gm=.01',
    'm1:nch( 1 2 0 0',
    'R7:rmod( x y G:(r=1k w=2u)',
    'x1:empty('
  ]);
});

test('analyses and control statements are shaped like instances and come back as instances, their master telling them apart', () => {
  assert.deepEqual(cards('tran tran stop=80us maxstep=10ns\nnoise1 (out 0) noise start=1 stop=1G\nsimulatorOptions options reltol=1e-3\nfinalTimeOP info what=oppoint where=rawfile\nmysweep dc dev=ia start=0 stop=10 step=1\n'), [
    'tran:tran P:stop=80us P:maxstep=10ns',
    'noise1:noise( out 0 P:start=1 P:stop=1G',
    'simulatorOptions:options P:reltol=1e-3',
    'finalTimeOP:info P:what=oppoint P:where=rawfile',
    'mysweep:dc P:dev=ia P:start=0 P:stop=10 P:step=1'
  ]);
});

test('a catalogue master is still a word where it is a node, and words may follow a parameter', () => {
  assert.deepEqual(cards('r1 (resistor 0) resistor r=1\nr2 resistor 0 resistor r=1\nr3 (1 0) resistor r=1 trailing word\n'), [
    'r1:resistor( resistor 0 P:r=1',
    'r2:resistor resistor 0 P:r=1',
    'r3:resistor( 1 0 P:r=1 trailing word'
  ]);
});

// --- Names (UG p.60, 62): case kept, `\` escapes, `!`, `.` and `:` in names ----

test('names keep their case, a backslash escapes any character into a name, and ! . : are ordinary name characters', () => {
  assert.deepEqual(cards('R0 (net1 net4) resistor r=1K\nr0 (net4 0) resistor r=1K\n\\2N2222 (c b e) npn\na\\-b (vdd! x1.int1) resistor r=1\nsave R1:1 X1.R1:1\nModel (1 0) resistor r=1\n'), [
    'R0:resistor( net1 net4 P:r=1K',
    'r0:resistor( net4 0 P:r=1K',
    '\\2N2222:npn( c b e',
    'a\\-b:resistor( vdd! x1.int1 P:r=1',
    'save R1:1 X1.R1:1',
    'Model:resistor( 1 0 P:r=1'
  ]);
});

// --- Comments (UG p.59): `//` or `*` first on a line, a blank then `//` anywhere; `//` glued to a word is text ----

test('// and * lines are comments, indented or not; a blank then // ends the line; // inside a word is text', () => {
  assert.deepEqual(cards('// Generated for: spectre\n   // indented\n*Comment lines start with *\nR1 (net7 V2) resistor r=1K // this is an inline Spectre comment\nR2 (0 V2) resistor r=a//b\nR3 (1 0) resistor r=1 //a blank before the slashes is enough\n'), [
    'R1:resistor( net7 V2 P:r=1K',
    'R2:resistor( 0 V2 P:r=a//b',
    'R3:resistor( 1 0 P:r=1'
  ]);
});

// --- Continuation (UG p.59): `\` at the end of a line, `+` at the start of the next; inside groups too ----

test('a line ending in \\ continues, glued to a value or not, and so does a + line, across blank and comment lines', () => {
  const output = read('V1 (net7 0) vsource dc=0 ampl=1\\\n        freq=1K damp=0\nsimulatorOptions options reltol=1e-3 \\\n    tnom=27 \\\n    digits=5\nmodel nfet bsimsoi\n+type = n\n+version = 3.2\nparameters\n\n // a comment between\n + s1 = 1\n + s2=2\n');
  assert.deepEqual(output.cards.map(compact), [
    'V1:vsource( net7 0 P:dc=0 P:ampl=1 P:freq=1K P:damp=0',
    'simulatorOptions:options P:reltol=1e-3 P:tnom=27 P:digits=5',
    'model nfet bsimsoi P:type=n',
    'parameters P:s1=1 P:s2=2'
  ]);
  assert.deepEqual(output.cards[0]!.tokens.map((t) => t.line), [1, 1, 1, 1, 2, 2]);
  assert.deepEqual(output.cards[3]!.tokens.map((t) => t.line), [12, 13]);
});

test('a group continued by \\ or by a + line closes on the continued line, its pieces joined by one blank, and knows the line it ends on', () => {
  const [i4, v0, x1] = read('I4 (net011 0) isource type=pwl delay=1m wave=[ 0 0.0 250u 1.0 \\\n        750u 1.0 1m 0.0 ]\nV0 (net1 0) vsource type=pwl wave=[0 0\n+ 1m 5] dc=1\nX1 (a\n+ b) sub\n').cards;
  const wave = i4!.tokens[4]!;
  assert.deepEqual([wave.class, wave.text, wave.line, wave.endLine, wave.end], ['pair', 'wave=[ 0 0.0 250u 1.0 750u 1.0 1m 0.0 ]', 1, 2, 25]);
  assert.deepEqual(v0!.tokens.map(token), ['net1', '0', 'P:type=pwl', 'P:wave=[0 0 1m 5]', 'P:dc=1']);
  assert.equal(v0!.tokens[3]!.endLine, 4);
  assert.deepEqual([compact(x1!), x1!.tokens[1]!.line], ['X1:sub( a b', 6]);
  const open = error('V1 (1 0) vsource wave=[0 0\nR1 (1 0) resistor r=1\n');
  assert.deepEqual([open.code, open.line, open.column, open.found.text, open.cards], ['unterminated-group', 1, 22, '[', ['V1:vsource( 1 0']]);
});

test('a + line with nothing before it is an orphan', () => {
  assert.equal(error('+ r=1\n').code, 'orphan-continuation');
});

// --- Keyword-led statements (UG p.71–76, 94; Reference 19.1 p.493–498): directive cards without a dot ----

test('model is trimmed to its name, master and type pair; subckt, inline subckt, ends, parameters, include, library and global are directives', () => {
  assert.deepEqual(cards('model npn bjt type=npn bf=80 rb=100\nmodel nch bsim3v3 (type=n tox=1e-9)\nsubckt coax (i1 o1 i2 o2)\nparameters zin=50 zout=50\nends coax\ninline subckt pnpMPA E B C\nends\nsubckt s1\nends s1\ninclude "models.scs"\ninclude "lib.scs" section=tt\n#include "defs.scs"\nahdl_include "va/opamp.va"\nlibrary mylib\nsection tt\nendsection tt\nendlibrary mylib\nsimulator lang=spectre insensitive=yes\nglobal 0 vdd!\n'), [
    'model npn bjt P:type=npn',
    'model nch bsim3v3 P:type=n',
    'subckt coax G:(i1 o1 i2 o2)',
    'parameters P:zin=50 P:zout=50',
    'ends coax',
    'inline subckt pnpMPA E B C',
    'ends',
    'subckt s1',
    'ends s1',
    'include G:"models.scs"',
    'include G:"lib.scs" P:section=tt',
    '#include G:"defs.scs"',
    'ahdl_include G:"va/opamp.va"',
    'library mylib',
    'section tt',
    'endsection tt',
    'endlibrary mylib',
    'simulator P:lang=spectre P:insensitive=yes',
    'global 0 vdd!'
  ]);
});

test('ic, nodeset, save, sens, real, export, protect and unprotect are directives; a function body closed on its line is a group', () => {
  assert.deepEqual(cards('ic cc=5\nnodeset out=1\nsave N04173 N03179\nsens v(out)\nreal f(real a, real b) { return a+b }\nexport x\nprotect\nunprotect\n'), [
    'ic P:cc=5', 'nodeset P:out=1', 'save N04173 N03179', 'sens v(out)', 'real f(real a, real b) G:{ return a+b }', 'export x', 'protect', 'unprotect'
  ]);
});

// --- Groups and quoting (UG p.59, 83–85): `(…)`, `[…]`, `{…}` closed on the line, `"…"` strings, blanks around `=` ----

test('parenthesised, bracketed and braced expressions are groups, glued to a word or bare; "…" is a group; blanks around = make one pair', () => {
  assert.deepEqual(cards('r1 (1 0) resistor r=1k*(1+tc) m = 2\nv1 (1 0) vsource type=pwl wave=[0 0 1 1] file="pwl file.txt"\nparameters c10=c1+c2 p=(a > 1) ? 2 : 3\nif (a > 1) r1 (1 0) resistor r=1\n'), [
    'r1:resistor( 1 0 P:r=1k*(1+tc) P:m=2',
    'v1:vsource( 1 0 P:type=pwl P:wave=[0 0 1 1] P:file="pwl file.txt"',
    'parameters P:c10=c1+c2 P:p=(a > 1) ? 2 : 3',
    'if G:(a > 1) r1 G:(1 0) resistor P:r=1'
  ]);
});

// --- Blocks (UG p.70, 108, 110, 167, 176): `{` ends a line, `}` starts one; statistics, paramset and model groups are swallowed ----

test('a { ending a line and a } starting one are cards, so if/else and sweep structure is visible and the instances inside are read', () => {
  assert.deepEqual(cards('if (a > 1) {\nr1 (1 0) resistor r=1\n} else {\nr1 (1 0) resistor r=2\n}\nsw1 sweep param=temp values=[25 75 100] {\nop1 dc\n}\nif (c)\n{\nr2 (1 0) resistor r=1\n}\n'), [
    'if G:(a > 1)', '{', 'r1:resistor( 1 0 P:r=1', '} else', '{', 'r1:resistor( 1 0 P:r=2', '}',
    'sw1:sweep P:param=temp P:values=[25 75 100]', '{', 'op1:dc', '}',
    'if G:(c)', '{', 'r2:resistor( 1 0 P:r=1', '}'
  ]);
});

test('statistics blocks, paramset tables and model bin groups are swallowed to their balanced }, on the same line or the next', () => {
  assert.deepEqual(cards('statistics {\n process {\n vary d1 dist=gauss std = s1\n }\n correlate param = [d2 d4] cc=0.5\n}\nr1 (1 0) resistor r=1\nstatistics\n{\n mismatch { vary x dist=gauss std=1 }\n}\nr2 (1 0) resistor r=2\nps1 paramset {\n1 2 3\n4 5 6\n}\nr3 (1 0) resistor r=3\nmodel nch bsim3v3 type=n {\n1: lmin=2 lmax=4\n2: lmin=1 lmax=2 }\nr4 (1 0) resistor r=4\n'), [
    'statistics', 'r1:resistor( 1 0 P:r=1', 'statistics', 'r2:resistor( 1 0 P:r=2', 'ps1:paramset', 'r3:resistor( 1 0 P:r=3', 'model nch bsim3v3 P:type=n', 'r4:resistor( 1 0 P:r=4'
  ]);
});

// --- Errors: the three codes, and a missing master ----

test('a line that starts with no name is not-an-element, a node list or group left open is unterminated-group, and a missing master is an uncoded error', () => {
  const equals = error('r1 (in out) resistor r=10k\n= 1\n');
  assert.deepEqual([equals.code, equals.line, equals.column, equals.found.text, equals.expected, equals.cards], ['not-an-element', 2, 0, '=', ['instance', 'directive'], ['r1:resistor( in out P:r=10k']]);
  assert.deepEqual([error('1abc (1 2) resistor\n').code, error('1abc (1 2) resistor\n').found.text], ['not-an-element', '1abc']);
  const nodes = error('r1 (1 2\nr2 (1 0) resistor r=1\n');
  assert.deepEqual([nodes.code, nodes.line, nodes.column, nodes.found.text, nodes.expected], ['unterminated-group', 1, 3, '(', ['end of node list']]);
  const master = error('r1 (1 2) r=1k\n');
  assert.deepEqual([master.code, master.line, master.column, master.found.class, master.found.text, master.expected], [undefined, 1, 9, 'parameter name', 'r', ['word', 'master', 'node list']]);
  const alone = error('r1\n');
  assert.deepEqual([alone.found.class, alone.expected], ['newline', ['word', 'master', 'node list']]);
});

// --- Spectre's SPICE mode (UG p.51–55): the SPICE base, case folded, `*spectre:` lines and `//` comments ----

test('in SPICE mode a *spectre: line is a statement, // lines and blank-// are comments, letters fold to upper case, and .end stops the read', () => {
  assert.deepEqual(cards('// Generated for: spectre\n*spectre: R1 1 0 1k\n*SPECTRE:r2 1 0 2k m=2\n* a comment\nR3 1 0 1k m=2 // note\nv1 1 0 1 \'a + b\'\n.model q npn (bf=100)\n.include "a b.lib"\n.end\nR4 1 0 1\n', 'spectre-spice'), [
    'R1:R 1 0 1k', 'r2:R 1 0 2k P:m=2', 'R3:R 1 0 1k P:m=2', "v1:V 1 0 1 G:'a + b'", '.model q npn', '.include G:"a b.lib"', '.end'
  ]);
  assert.equal(read('R1 1 0 1\n.end\nR2 1 0 1\n', 'spectre-spice').afterEnd, 1);
});
