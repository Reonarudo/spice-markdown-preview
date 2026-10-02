/**
 * The vendored ngspice module against what ngspice-47 accepts, one case per finding of the ngspice
 * research (Redmine #1184), and against real decks from the ngspice tree (`test/fixtures/ngspice/`).
 * The module only classifies (ADR 0008): these tests say which cards and tokens a line becomes,
 * never what is drawn.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { DIALECTS } from '../src/catalogue/dialects';
import type { Card, ParserOutput, Token } from '../src/parser/contract';
import { loadParser, parse, type ParserFactory } from '../src/parser/registry';
import { checkDocument } from './helpers/parser-output';

const require = createRequire(import.meta.url);

before(async () => {
  await loadParser('ngspice', require('../vendor/parsers/ngspice.cjs') as ParserFactory);
});

/** Parse, check the contract, and return the document. */
function read(text: string): ParserOutput {
  const output = parse('ngspice', text);
  checkDocument(output, text, JSON.stringify(text));
  return output;
}

/** The cards of a well-formed netlist, compactly: `R1:R a b 1k`, `.model:m npn level=2`, `X1:X( a b ) sub`. */
function cards(text: string): string[] {
  const output = read(text);
  assert.equal(output.error, undefined, `${JSON.stringify(text)}: ${JSON.stringify(output.error)}`);
  return output.cards.map(compact);
}

function compact(card: Card): string {
  const head = card.kind === 'element' ? `${card.ref}:${card.letter}${card.selector !== undefined ? `/${card.selector}` : ''}${card.nodesClosed ? '(' : ''}` : card.name;
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

// --- Comments (research: `*`, `#`, leading specials, `;`, `$`, `//`) ---------------------------------

test('a line whose first non-blank character is * or # is a comment, and so is one starting with = [ ] ? ( ) & % $ " ! : ,', () => {
  assert.deepEqual(cards('* title-like comment\n  * indented\n# hash\n= x\n[v]\n?\n(a b) c\n) x\n& old param\n%v\n$ dollar\n"quoted"\n! bang\n: colon\n, comma\nR1 a b 1\n'), ['R1:R a b 1']);
});

test('; starts a comment anywhere, even at the start of a line', () => {
  assert.deepEqual(cards('; whole line\nR1 a b 1k ; trailing\nR2 a b 2k;glued\n'), ['R1:R a b 1k', 'R2:R a b 2k']);
});

test('$ starts a comment after a blank, a tab or a comma, and nowhere else', () => {
  assert.deepEqual(cards('R1 a b 1k $ note\nR2 a b 2k\t$note\nR3 a b 3k,$ note\nR4 a b 4k$x\n'), ['R1:R a b 1k', 'R2:R a b 2k', 'R3:R a b 3k', 'R4:R a b 4k$x']);
});

test('// starts a comment anywhere, glued to a word or not, while a single / stays part of a name', () => {
  assert.deepEqual(cards('R1 a b 3k//x\nR2 /in Net-_U1-+_ 1k // kicad names\n// whole line\nR3 a/b c 1\n'), ['R1:R a b 3k', 'R2:R /in Net-_U1-+_ 1k', 'R3:R a/b c 1']);
});

test("comment characters inside '…' or \"…\" are not comments", () => {
  assert.deepEqual(cards("R1 a 0 r='V(a) ; $ // < 1 ? 1 : 2'\n.include \"my; file.lib\"\n"), ["R1:R a 0 P:r='V(a) ; $ // < 1 ? 1 : 2'", '.include G:"my; file.lib"']);
});

// --- Continuation ----------------------------------------------------------------------------------

test('+ continues the previous card, with comment and blank lines allowed between the pieces, and each token keeps its own line', () => {
  const output = read('R1 a b\n* between\n\n  + 1k\n+ tc1=1\n');
  assert.deepEqual(output.cards.map(compact), ['R1:R a b 1k P:tc1=1']);
  assert.deepEqual(output.cards[0]!.tokens.map((t) => t.line), [1, 1, 4, 5]);
});

test('a line ending in \\\\ continues on the next line', () => {
  assert.deepEqual(cards('R1 a b \\\\\n1k\nR2 a b 2k\n'), ['R1:R a b 1k', 'R2:R a b 2k']);
});

test('a + with nothing before it is the coded error orphan-continuation', () => {
  const found = error('+ R1 a b 1\n');
  assert.equal(found.code, 'orphan-continuation');
  assert.deepEqual([found.line, found.column, found.end, found.found.text], [1, 0, 1, '+']);
  assert.deepEqual(found.cards, []);
});

// --- Separators, groups and pairs ---------------------------------------------------------------------

test('fields are separated by blanks, tabs and commas; = joins a pair even with spaces around it', () => {
  assert.deepEqual(cards('M1 d,g s\tb nmos W = 1u L=0.5u ic=1,2\n'), ['M1:M d g s b nmos P:W=1u P:L=0.5u P:ic=1 2']);
});

test('(…) and {…} groups keep their spaces and nested brackets, glued to a word or on their own', () => {
  assert.deepEqual(cards('V1 a 0 SIN(0 1 1k) ac {2*(1+x)}\n.print ac db(i(vmeas)) v(out)\nV2 a 0 pwl(0 0 1m (1))\n'), [
    'V1:V a 0 SIN(0 1 1k) ac G:{2*(1+x)}',
    '.print ac db(i(vmeas)) v(out)',
    'V2:V a 0 pwl(0 0 1m (1))'
  ]);
});

test("'…' is an expression and \"…\" a string: both are groups that may hold spaces", () => {
  assert.deepEqual(cards(".param a = '123 * 3'\nV1 1 0 '2--3'\nC1 a 0 c='1n * 2'\n"), [".param P:a='123 * 3'", "V1:V 1 0 G:'2--3'", "C1:C a 0 P:c='1n * 2'"]);
});

test('a bracket that does not close on its line or a + line continuing it is the coded error unterminated-group, pointing at the bracket', () => {
  const found = error('R1 a b 1\nV1 a 0 pulse(0 1 0 1n\nR2 a b 2\n');
  assert.equal(found.code, 'unterminated-group');
  assert.deepEqual([found.line, found.column, found.end, found.found.text], [2, 12, 13, '(']);
  assert.deepEqual(found.cards, ['R1:R a b 1', 'V1:V a 0'], 'the cards before the error are kept');
  assert.equal(error('X1 (a b sub\n').code, 'unterminated-group');
  assert.equal(error('.param x={1\n').found.text, '{');
  assert.deepEqual([error('V1 a 0 pulse(0 1\n+ 0 1n\nR2 a b 2\n').line, error('V1 a 0 pulse(0 1\n+ 0 1n\nR2 a b 2\n').found.text], [1, '('], 'continued once and still open');
});

test('a group closed on a + line is one token joined by a blank, ending on that line; a node list may continue too', () => {
  // Every SPICE simulator joins `+` lines before tokenising, so `PWL(…` may close lines later (ADR 0008, groups across continuation lines).
  const pwl = read('VS 1 0 PWL(0S 0V 1S 1V \n* between\n\n+ 2S 4V)\nR1 a b 1k\n');
  assert.deepEqual(pwl.cards.map(compact), ['VS:V 1 0 PWL(0S 0V 1S 1V 2S 4V)', 'R1:R a b 1k']);
  const group = pwl.cards[0]!.tokens[2]!;
  assert.deepEqual([group.line, group.column, group.endLine, group.end], [1, 7, 4, 8], 'the token starts at PWL and ends after the ) on line 4');
  const pair = read('B1 a b I={limit( (P*V(a)),\n+ voltlim=1 ) }\n').cards[0]!.tokens[2]!;
  assert.deepEqual([pair.class, pair.text, pair.value, pair.endLine, pair.end], ['pair', 'I={limit( (P*V(a)), voltlim=1 ) }', '{limit( (P*V(a)), voltlim=1 ) }', 2, 15]);
  assert.deepEqual(cards('X1 (a b\n+ c) sub\n'), ['X1:X( a b c sub']);
  assert.equal(read('R1 a b r=\n+ 1k\n').cards[0]!.tokens[2]!.endLine, 2, 'a pair split at its = ends on the value\'s line');
  assert.equal(read('R1 a b 1k\n+ tc1=1\n').cards[0]!.tokens[3]!.endLine, undefined, 'a token on one line has no endLine');
});

// --- Heads -------------------------------------------------------------------------------------------

test('every ngspice element letter opens an element card, upper-cased, including A N P U and Y', () => {
  for (const letter of DIALECTS.ngspice.letters) {
    const lower = letter.toLowerCase();
    assert.deepEqual(cards(`${lower}1 a b c\n`), [`${lower}1:${letter} a b c`]);
  }
  assert.deepEqual(cards('a1 %v[in in2] out sum1\na2 [~d1 d2] d3 nand1\na3 %vd(in 0) %id(o1 0) g1\n'), [
    'a1:A %v[in in2] out sum1',
    'a2:A [~d1 d2] d3 nand1',
    'a3:A %vd(in 0) %id(o1 0) g1'
  ], 'XSPICE port syntax comes through as words for the catalogue rule');
});

test('a line that is neither an element nor a directive is the coded error not-an-element', () => {
  const found = error('R1 a b 1\n1R a b 1k\n');
  assert.equal(found.code, 'not-an-element');
  assert.deepEqual([found.line, found.column, found.end, found.found.text], [2, 0, 2, '1R']);
  assert.deepEqual(found.expected, ['element', 'directive']);
});

test('directive names come back lower-cased with their dot, whatever they are: .macro, .eom, .incl, .if', () => {
  assert.deepEqual(cards('.MACRO m a b\nR1 a b 1\n.EOM\n.incl models.lib\n.IF (x == 1)\n.ENDIF\n.title not a comment here\n'), [
    '.macro m a b', 'R1:R a b 1', '.eom', '.incl models.lib', '.if G:(x == 1)', '.endif', '.title not a comment here'
  ]);
});

test('a parenthesised node list right after an element name is unwrapped into words and flagged nodesClosed', () => {
  assert.deepEqual(cards('X1 (a b) sub params: k=3\nX2 ( a , b ) sub\nR1 (a b) 1k\n'), ['X1:X( a b sub params: P:k=3', 'X2:X( a b sub', 'R1:R( a b 1k']);
  assert.deepEqual(cards('.subckt s (a b)\n'), ['.subckt s G:(a b)'], 'on a directive the list stays a group for TypeScript to unwrap');
});

// --- Dependent sources -------------------------------------------------------------------------------

test('E and G forms: POLY(n) and and(n) are one keyword token, vol=/cur=/value= are pairs, TABLE and VCVS are keywords', () => {
  assert.deepEqual(cards([
    'E1 1 0 POLY(2) a 0 b 0 0 1 1',
    'E2 1 0 value={V(a)*2}',
    "G1 1 0 cur='V(a)'",
    'E3 1 0 vol=\'V(a)\'',
    'E4 1 0 TABLE {V(a)} = (0 0) (1 1)',
    'E5 1 0 vcvs a 0 2',
    'E6 1 0 and(2) a 0 b 0 (0.5, 4.5)',
    'E7 1 0 a 0 2'
  ].join('\n') + '\n'), [
    'E1:E 1 0 K:POLY(2) a 0 b 0 0 1 1',
    'E2:E 1 0 P:value={V(a)*2}',
    "G1:G 1 0 P:cur='V(a)'",
    "E3:E 1 0 P:vol='V(a)'",
    'E4:E 1 0 K:TABLE P:{V(a)}=(0 0) G:(1 1)',
    'E5:E 1 0 K:vcvs a 0 2',
    'E6:E 1 0 K:and(2) a 0 b 0 G:(0.5, 4.5)',
    'E7:E 1 0 a 0 2'
  ]);
});

test('a keyword used as a node name is still classified as a keyword; the catalogue form decides', () => {
  assert.deepEqual(cards('R1 and or 1k\n'), ['R1:R K:and K:or 1k']);
});

// --- .model ------------------------------------------------------------------------------------------

test('.model keeps its bare words and the level pair only, whether the parameters are bare, parenthesised or continued', () => {
  assert.deepEqual(cards([
    '.model bc547 npn(bf=100 level=2)',
    '.MODEL N1 NPN LEVEL=4',
    '+ IS=1e-16 RTH=300',
    '.model nand1 d_nand(rise_delay = 0.7e-9',
    '+ fall_delay = 0.7e-9)',
    '.model vd vdmos pchan',
    '.model r1 r r={x*2}',
    '.model m1 nmos ( level = 49 tox=1n )'
  ].join('\n') + '\n'), [
    '.model bc547 npn P:level=2',
    '.model N1 NPN P:LEVEL=4',
    '.model nand1 d_nand',
    '.model vd vdmos pchan',
    '.model r1 r',
    '.model m1 nmos P:level=49'
  ]);
  const [model] = read('.model bc547 npn(bf=100)\n').cards;
  assert.deepEqual(model!.tokens.map((t) => [t.text, t.column, t.end]), [['bc547', 7, 12], ['npn', 13, 16]], 'the type word is positioned without its parentheses');
});

// --- Opaque regions and .end -------------------------------------------------------------------------

test('.control … .endc is swallowed: only the two directive cards come back, and .endc counts only as a whole word at the start of a line', () => {
  assert.deepEqual(cards('.control\nset foo = ( 1 2 )\nR9 x y 1\n  .endcx\nif a .endc\n.endc\nR1 a b 1\n'), ['.control', '.endc', 'R1:R a b 1']);
  assert.deepEqual(cards('.control\nop\n'), ['.control'], 'an unclosed block ends the file without an error; TypeScript reports it');
  assert.deepEqual(cards('.endc\nR1 a b 1\n'), ['.endc', 'R1:R a b 1'], 'outside a block .endc is an ordinary directive');
});

test('the first .end ends the netlist; afterEnd counts the non-blank, non-comment lines after it, and is absent when there are none', () => {
  const output = read('R1 a b 1\n.end\n* comment\n\nR2 a b 2\nfoo');
  assert.deepEqual(output.cards.map(compact), ['R1:R a b 1', '.end']);
  assert.equal(output.afterEnd, 2);
  assert.equal(read('R1 a b 1\n.end').afterEnd, undefined);
  assert.equal(read('R1 a b 1\n.end\n\n').afterEnd, undefined);
  assert.deepEqual(cards('.ends\n.endc\n.endl\nR1 a b 1\n'), ['.ends', '.endc', '.endl', 'R1:R a b 1'], 'only .end itself stops the reading');
});

// --- Positions and endings ---------------------------------------------------------------------------

test('CRLF files, a last line without a newline, an empty file and a lone comment all parse', () => {
  assert.deepEqual(cards('R1 a b 1\r\n+ 2\r\nR2 a b 2\r\n'), ['R1:R a b 1 2', 'R2:R a b 2']);
  assert.deepEqual(cards('R1 a b 1'), ['R1:R a b 1']);
  assert.deepEqual(cards(''), []);
  assert.deepEqual(cards('* hi'), []);
  assert.deepEqual(cards('R1\n'), ['R1:R'], 'a head alone is a card with no tokens; TypeScript reports what is missing');
});

test('a plain syntax error names what was found and what was expected in the contract vocabulary, anchored on the line', () => {
  const found = error('R1 a b =\nR2 a b 1\n');
  assert.equal(found.code, undefined);
  assert.deepEqual([found.line, found.column, found.end], [1, 7, 8]);
  assert.equal(found.found.class, 'newline');
  assert.deepEqual(found.expected, ['word', 'keyword', 'group']);
  assert.deepEqual(found.cards, ['R1:R a']);
});

// --- Real decks ----------------------------------------------------------------------------------------

const CORPUS = join(import.meta.dirname, 'fixtures/ngspice/corpus');

/** Element and directive counts when each file was added; a change here is a change in what the grammar accepts. */
const EXPECTED: Record<string, [elements: number, directives: number]> = {
  'examples/TransmissionLines/URC-TM-SUB.cir': [3, 6],
  'examples/TransmissionLines/cpl1_4_line.sp': [27, 6],
  'examples/cider/bjt/astable.cir': [10, 5],
  'examples/control_structs/if-test-1.cir': [2, 3],
  'examples/digital/compare/adder_Xspice.cir': [26, 13],
  'examples/digital/compare/adder_mos.cir': [27, 16],
  'examples/digital/digital_devices/counter.cir': [12, 8],
  'examples/loops/loop_IfThenElse.cir': [0, 3],
  'examples/measure/simple-meas-tran.sp': [3, 26],
  'examples/mos/nmos_pmos_BSIM330.sp': [10, 5],
  'examples/osdi/hicuml0/DFF_Y_ECL_VBIC.sp': [26, 5],
  'tests/bsim3soipd/inv2.cir': [6, 5],
  'tests/general/mosmem.cir': [16, 9],
  'tests/general/schmitt.cir': [15, 7],
  'tests/polezero/filt_rc.cir': [3, 4],
  'tests/regression/lib-processing/ex1a.cir': [5, 6],
  'tests/regression/misc/bugs-2.cir': [1, 3],
  'tests/regression/misc/dollar-1.cir': [1, 3],
  'tests/regression/misc/if-elseif.cir': [9, 16],
  'tests/regression/parser/minus-minus.cir': [2, 3],
  'tests/transmission/txl1_1_line.cir': [7, 7],
  'tests/vbic/CEamp.cir': [7, 8],
  'tests/xspice/digital/d_source.cir': [2, 4]
};

function decks(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return decks(path);
    return /\.(cir|sp)$/.test(entry.name) ? [path] : [];
  });
}

test('every deck in the ngspice corpus parses without a structural error once its title line is dropped, with the card counts it was added with', () => {
  // Keys are written with `/` whatever the platform's separator is.
  const found = decks(CORPUS).map((path) => relative(CORPUS, path).split(sep).join('/')).sort();
  assert.deepEqual(found, Object.keys(EXPECTED).sort(), 'every corpus file has an entry in EXPECTED, and vice versa');
  for (const name of found) {
    // The first line of a SPICE deck is its title; a fence has none (ADR 0006).
    const text = readFileSync(join(CORPUS, name), 'utf8').replace(/^[^\n]*\n/, '');
    const output = parse('ngspice', text);
    checkDocument(output, text, name);
    assert.equal(output.error, undefined, `${name}: ${JSON.stringify(output.error)}`);
    const elements = output.cards.filter((card) => card.kind === 'element').length;
    const directives = output.cards.length - elements;
    assert.deepEqual([elements, directives], EXPECTED[name], name);
  }
});
