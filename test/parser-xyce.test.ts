/**
 * The vendored Xyce module against what Xyce 7.10 accepts, one case per finding of the Xyce
 * research (Redmine #1188) that changes how a line is cut into tokens. The module only classifies
 * (ADR 0008): these tests say which cards and tokens a line becomes, never what is drawn —
 * `test/netlist-xyce.test.ts` does that.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALECTS } from '../src/catalogue/dialects';
import type { Card, ParserOutput, Token } from '../src/parser/contract';
import { parse } from '../src/parser/registry';
import { checkDocument } from './helpers/parser-output';
import { loadXyce } from './helpers/xyce';

before(loadXyce);

/** Parse, check the contract, and return the document. */
function read(text: string): ParserOutput {
  const output = parse('xyce', text);
  checkDocument(output, text, JSON.stringify(text));
  return output;
}

/** The cards of a well-formed netlist, compactly: `R1:R a b 1k`, `.model:m npn level=2`, `mr1:Y/MEMRISTOR a b m`. */
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

// --- Comments (RG §2.1.39.1–2; disagreements 1–3): `*` lines, `;` anywhere, and any indented line ----

test('* at the start of a line and ; anywhere are comments', () => {
  assert.deepEqual(cards('* a comment\nR1 a b 1k ; load\nR2 a b 2k;no blank needed\n'), ['R1:R a b 1k', 'R2:R a b 2k']);
});

test('a line that starts with a blank or a tab is a comment, whatever it holds', () => {
  assert.deepEqual(cards('R1 a b 1k\n  R2 a b 2k\n\tR3 a b 3k\n   * also a comment\n \n   \n  .end\nR4 a b 4k\n'), ['R1:R a b 1k', 'R4:R a b 4k']);
  assert.equal(read('R1 a b 1k\n  R2 a b 2k').afterEnd, undefined, 'an indented .end would have ended the read; an indented element is simply dropped');
});

test('$ and // are text: $GVDD is a node and // stays in the value', () => {
  assert.deepEqual(cards('R1 $GVDD out 1k\nR2 out 0 1k // still text\nR3 a b 3k$x\n'), ['R1:R $GVDD out 1k', 'R2:R out 0 1k // still text', 'R3:R a b 3k$x']);
});

// --- Continuation (RG §2.1.39.3; disagreement 4): `+` only, across comment and blank lines; no trailing `\\` ----

test('+ continues the previous card across *, ;, indented and blank lines; a line ending in \\\\ does not continue', () => {
  const output = read('.MODEL n1 NMOS\n* comment between\n; and another\n   indented comment between\n\n+ LEVEL=9\nV1 in 0 PWL 0 0 \\\\\nR1 a b 1k\n');
  assert.deepEqual(output.cards.map(compact), ['.model n1 NMOS P:LEVEL=9', 'V1:V in 0 PWL 0 0 \\\\', 'R1:R a b 1k']);
  assert.deepEqual(output.cards[0]!.tokens.map((t) => t.line), [1, 1, 6]);
});

test('an indented + continues too, and a + line with nothing before it is an orphan', () => {
  assert.deepEqual(cards('R1 a b\n   + 1k\n'), ['R1:R a b 1k']);
  assert.equal(error('+ R1 a b 1k\n').code, 'orphan-continuation');
  assert.equal(error('  + R1 a b 1k\n').code, 'orphan-continuation', 'indentation before the orphan + is not a comment');
});

// --- Heads (RG Table 2-35, §2.3.28, §2.3.11; disagreements 6–9): Y<type> <name>, U gates, P ports; no A or N ----

test('every Xyce element letter opens an element card, upper-cased, P and Y included', () => {
  for (const letter of DIALECTS.xyce.letters) {
    const lower = letter.toLowerCase();
    if (letter === 'Y') continue;
    assert.deepEqual(cards(`${lower}1 a b c\n`), [`${lower}1:${letter} a b c`]);
  }
  assert.ok(['P', 'U', 'Y', 'S', 'K'].every((letter) => DIALECTS.xyce.letters.includes(letter)));
});

test('A and N are not Xyce elements', () => {
  for (const letter of ['A', 'N']) {
    const found = error(`${letter}1 a b c\n`);
    assert.equal(found.code, 'not-an-element', letter);
    assert.equal(found.found.text, `${letter}1`);
  }
});

test('Y<type> <name> is a suffixed head whose ref is the second token and whose selector is the type, for a catalogued type or any other', () => {
  assert.deepEqual(cards('YMEMRISTOR mr1 n1 n2 mrm2\nypde diode1 anode cathode zmod\nYACC acc1 acc vel pos v0=10 x0=0\nYLIN YLIN1 1 0 2 0 YLIN_MOD1\nYDELAY delay1 2 0 1 0 TD=10N\nYOPAMP op1 inp inn out\nyand myand in1 in2 out dmod\n'), [
    'mr1:Y/MEMRISTOR n1 n2 mrm2',
    'diode1:Y/PDE anode cathode zmod',
    'acc1:Y/ACC acc vel pos P:v0=10 P:x0=0',
    'YLIN1:Y/LIN 1 0 2 0 YLIN_MOD1',
    'delay1:Y/DELAY 2 0 1 0 P:TD=10N',
    'op1:Y/OPAMP inp inn out',
    'myand:Y/AND in1 in2 out dmod'
  ]);
});

test('a Y type with a name starting with an element letter still reads the name as a word, and a lone Y with no type is a Y element', () => {
  assert.deepEqual(cards('YMEMRISTOR r1 a b m\nYTRANSLINE line1 inn out testLine len=12 lumps=1440\nY a b c\n'), [
    'r1:Y/MEMRISTOR a b m',
    'line1:Y/TRANSLINE inn out testLine P:len=12 P:lumps=1440',
    'Y:Y a b c'
  ]);
  const found = error('YMEMRISTOR\n');
  assert.deepEqual([found.found.class, found.expected], ['newline', ['word']], 'a Y line with only its type has no name');
});

test('U gate types with or without an input count are keywords, NOT included; P ports and the generic S switch keep words and pairs', () => {
  assert.deepEqual(cards('U1 AND(2) dpwr dgnd in1 in2 out dmod\nUINV NOT dpwr dgnd a y dmod\nU2 DFF dpwr dgnd preb clrb clk d q qb dmod\nP1 in 0 port=1 Z0=50\nS1 1 2 SWI OFF CONTROL={I(VMON)}\nS2 1 2 3 4 swmod ON\n'), [
    'U1:U K:AND(2) dpwr dgnd in1 in2 out dmod',
    'UINV:U K:NOT dpwr dgnd a y dmod',
    'U2:U K:DFF dpwr dgnd preb clrb clk d q qb dmod',
    'P1:P in 0 P:port=1 P:Z0=50',
    'S1:S 1 2 SWI OFF P:CONTROL={I(VMON)}',
    'S2:S 1 2 3 4 swmod ON'
  ]);
});

// --- Quoting and groups (RG §2.2; SSFT L168–219): '…' and "…" are groups, {…} nests, [SUB] is a word ----

test("'…' and \"…\" are groups that may hold spaces; {…} is a group with nesting; [SUB] is a word", () => {
  assert.deepEqual(cards("R1 a b {r0 * (1 + tc)}\nR2 1 0 'abs(v(c)) + abs(v(d))'\n.PARAM name=\"a string\"\nQ6 VC 4 11 [SUB] LAXPNP\nE1 1 0 VALUE={V(3)*2}\nG1 1 0 TABLE {V(a)} = (0,0) (1,1)\n"), [
    'R1:R a b G:{r0 * (1 + tc)}',
    "R2:R 1 0 G:'abs(v(c)) + abs(v(d))'",
    '.param P:name="a string"',
    'Q6:Q VC 4 11 [SUB] LAXPNP',
    'E1:E 1 0 P:VALUE={V(3)*2}',
    'G1:G 1 0 K:TABLE P:{V(a)}=(0,0) G:(1,1)'
  ]);
});

test('a group continued onto a + line closes there, whether it is a value or a pair\'s value, with Xyce\'s comment lines between', () => {
  // Xyce_Regression's PDE decks write `+ region={name = reg1,` across lines, and 57 of its decks continue a PWL or a brace expression this way.
  const bare = read('V1 in 0 PWL(0 0\n  indented comment\n; another\n+ 1m 5)\n').cards[0]!.tokens[2]!;
  assert.deepEqual([bare.text, bare.line, bare.column, bare.endLine, bare.end], ['PWL(0 0 1m 5)', 1, 8, 4, 7]);
  const paired = read('YPDE pde1 a b zmod\n+ region={name = reg1,\n+ xlo=0}\n').cards[0]!.tokens[3]!;
  assert.deepEqual([paired.class, paired.text, paired.line, paired.column, paired.endLine, paired.end], ['pair', 'region={name = reg1, xlo=0}', 2, 2, 3, 8]);
  const open = error('V1 in 0 PWL(0 0\n  indented comment\nR1 a b 1k\n');
  assert.deepEqual([open.code, open.line, open.found.text, open.cards], ['unterminated-group', 1, '(', ['V1:V in 0']], 'a comment line and then no + leaves the group open; the card in progress is kept up to the error');
});

// --- Directives (RG §2.1.15–16, §2.1.28, §2.1.12, §2.1.37): .INCL, quoted file names, .LIB file entry, .PREPROCESS, .GLOBAL_PARAM ----

test('.INC, .INCL and .INCLUDE take a bare or quoted file; .LIB file entry, section definitions, .ENDL name, .PREPROCESS and .GLOBAL_PARAM are directives', () => {
  assert.deepEqual(cards('.INCL "models.inc"\n.inc \'sub.inc\'\n.INCLUDE models.lib\n.LIB "cmos.lib" tt\n.LIB tt\n.ENDL tt\n.PREPROCESS REPLACEGROUND TRUE\n.GLOBAL_PARAM vdd=1.8\n.GLOBAL $GVDD\n'), [
    '.incl G:"models.inc"', ".inc G:'sub.inc'", '.include models.lib', '.lib G:"cmos.lib" tt', '.lib tt', '.endl tt', '.preprocess REPLACEGROUND TRUE', '.global_param P:vdd=1.8', '.global $GVDD'
  ]);
});

test('nested .SUBCKT definitions and .MODEL cards keep their arguments; a model keeps its type and level', () => {
  assert.deepEqual(cards('.SUBCKT outer a b PARAMS: w=1u\n.SUBCKT inner c d\nR1 c d 1k\n.ENDS inner\nX1 a b inner\n.ENDS outer\n.MODEL mvs NMOS LEVEL=2000 (vth=0.4)\n.MODEL core CORE (ms=1)\n'), [
    '.subckt outer a b PARAMS: P:w=1u', '.subckt inner c d', 'R1:R c d 1k', '.ends inner', 'X1:X a b inner', '.ends outer', '.model mvs NMOS P:LEVEL=2000', '.model core CORE'
  ]);
});

// --- Several circuits in one file: the first .END ends the read ----------

test('the first .END stops the read, and the lines of the next circuit are counted', () => {
  const output = read('R1 a 0 1k\n.END\n* second\nR2 a 0 1k\n.END\n');
  assert.deepEqual(output.cards.map(compact), ['R1:R a 0 1k', '.end']);
  assert.equal(output.afterEnd, 2);
});
