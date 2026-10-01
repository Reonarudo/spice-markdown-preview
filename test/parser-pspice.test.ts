/**
 * The vendored PSpice module against what PSpice A/D 16.6 accepts, one case per finding of the
 * PSpice research (Redmine #1186) that changes how a line is cut into tokens. The module only
 * classifies (ADR 0008): these tests say which cards and tokens a line becomes, never what is
 * drawn — `test/netlist-pspice.test.ts` does that.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALECTS } from '../src/catalogue/dialects';
import type { Card, ParserOutput, Token } from '../src/parser/contract';
import { parse } from '../src/parser/registry';
import { loadPspice } from './helpers/pspice';
import { checkDocument } from './helpers/parser-output';

before(loadPspice);

/** Parse, check the contract, and return the document. */
function read(text: string): ParserOutput {
  const output = parse('pspice', text);
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

// --- Comments (RG p.125–126; disagreements 1 and 2: `$` and `//` are text) ---------------------------

test('* at the start of a line and ; anywhere are comments, and so is a # line', () => {
  assert.deepEqual(cards('* source AMP\n  * indented\n# a hash line\n; whole line\nR1 a b 1k ; trailing\nR2 a b 2k;glued\n'), ['R1:R a b 1k', 'R2:R a b 2k']);
});

test('$ is never a comment: $G_DPWR and $D_HI are nodes, $ after a blank is text, and DATA=B$ … $ is program data', () => {
  assert.deepEqual(cards('R1 $G_DPWR out 1k\nR2 a b 2k $ not a comment\nU1 ROM(1,1) $G_DPWR $G_DGND en a o ROM_1 IO_STD DATA=B$ 01 10 $\nC1 $D_HI 0 1n\n'), [
    'R1:R $G_DPWR out 1k',
    'R2:R a b 2k $ K:not a comment',
    'U1:U K:ROM(1,1) $G_DPWR $G_DGND en a o ROM_1 IO_STD P:DATA=B$ 01 10 $',
    'C1:C $D_HI 0 1n'
  ]);
});

test('// is not a comment: it stays inside a word, and a line starting with it is not an element', () => {
  assert.deepEqual(cards('R1 a b 3k//x\nR2 /in out 1k\n'), ['R1:R a b 3k//x', 'R2:R /in out 1k']);
  const found = error('R1 a b 1k\n// not a comment here\n');
  assert.equal(found.code, 'not-an-element');
  assert.deepEqual([found.line, found.found.text, found.cards], [2, '//', ['R1:R a b 1k']]);
});

// --- Continuation (RG p.127; comment lines between the pieces, as RG's own U examples) ------------------

test('+ continues the previous card across comment and blank lines, glued or not; a trailing \\\\ does not', () => {
  const output = read('U1 STIM(1,1) $G_DPWR $G_DGND s IO_STM\n+ 0s 1\n* a pulse\n\n+10ns 0\nV1 in 0 AC 1\n+SIN 0 1 1KHz 0 0 0\n');
  assert.deepEqual(output.cards.map(compact), ['U1:U K:STIM(1,1) $G_DPWR $G_DGND s IO_STM 0s 1 10ns 0', 'V1:V in 0 AC 1 SIN 0 1 1KHz 0 0 0']);
  assert.deepEqual(output.cards[0]!.tokens.map((t) => t.line), [1, 1, 1, 1, 1, 2, 2, 5, 5]);
  assert.deepEqual(read('R1 a b \\\\\n1k\n').cards.map(compact), ['R1:R a b \\\\']);
  assert.equal(error('R1 a b \\\\\n1k\n').code, 'not-an-element');
});

// --- Heads (RG p.134–136; disagreements 3–7: B Z N O U are PSpice devices; no A, P or Y) ------------

test('every PSpice element letter opens an element card, upper-cased, N included', () => {
  for (const letter of DIALECTS.pspice.letters) {
    const lower = letter.toLowerCase();
    assert.deepEqual(cards(`${lower}1 a b c\n`), [`${lower}1:${letter} a b c`]);
  }
  assert.ok(DIALECTS.pspice.letters.includes('N') && DIALECTS.pspice.letters.includes('O') && DIALECTS.pspice.letters.includes('U'));
});

test('A, P and Y are not PSpice elements', () => {
  for (const letter of ['A', 'P', 'Y']) {
    const found = error(`${letter}1 a b c\n`);
    assert.equal(found.code, 'not-an-element', letter);
    assert.equal(found.found.text, `${letter}1`);
  }
});

// --- Digital primitives (RG p.349–350): the type's parameters may follow after blanks -----------------

test('a primitive type with its parentheses is one keyword, with or without blanks around them, and glued text after it is the next word', () => {
  assert.deepEqual(cards([
    'U1 NAND(2) $G_DPWR $G_DGND a b y D_00 IO_STD',
    'U2 PINDLY (5,0,10) $G_DPWR $G_DGND a b c d e o1 o2 o3 o4 o5 IO_STD',
    'U3 STIM( 1, 1 ) $G_DPWR $G_DGND s IO_STM',
    'U4 SRFF(4)$G_DPWR $G_DGND a b c IO',
    'U5 PLANDC(3, 8) $G_DPWR $G_DGND i1 i2 i3 o1 o2 o3 o4 o5 o6 o7 o8 PLD_1 IO_STD'
  ].join('\n') + '\n'), [
    'U1:U K:NAND(2) $G_DPWR $G_DGND a b y D_00 IO_STD',
    'U2:U K:PINDLY (5,0,10) $G_DPWR $G_DGND a b c d e o1 o2 o3 o4 o5 IO_STD',
    'U3:U K:STIM( 1, 1 ) $G_DPWR $G_DGND s IO_STM',
    'U4:U K:SRFF(4) $G_DPWR $G_DGND a b c IO',
    'U5:U K:PLANDC(3, 8) $G_DPWR $G_DGND i1 i2 i3 o1 o2 o3 o4 o5 o6 o7 o8 PLD_1 IO_STD'
  ]);
});

test('the section words of a primitive tail — PINDLY:, LOGIC:, BOOLEAN: — are words, not keywords, and their assignments are pairs', () => {
  assert.deepEqual(cards('U1 PINDLY (1,0,0) $G_DPWR $G_DGND a y IO_STD\n+ PINDLY: y = { DELAY(5ns, 8ns, 12ns) }\nU2 LOGICEXP(2,1) $G_DPWR $G_DGND a b y D_LGC IO_STD\n+ LOGIC: y = { a & b }\n'), [
    'U1:U K:PINDLY (1,0,0) $G_DPWR $G_DGND a y IO_STD PINDLY: P:y={ DELAY(5ns, 8ns, 12ns) }',
    'U2:U K:LOGICEXP(2,1) $G_DPWR $G_DGND a b y D_LGC IO_STD LOGIC: P:y={ a & b }'
  ]);
});

// --- Dependent sources (RG p.165–178): every PSpice shape of E and G ---------------------------------

test('VALUE, TABLE, LAPLACE, FREQ and CHEBYSHEV are keywords after two nodes; = joins a pair; F= and Q= are pairs; POLY(n) keeps its pairs as groups', () => {
  assert.deepEqual(cards([
    'E1 1 0 VALUE = {V(a)*2}',
    'E2 1 0 VALUE {V(a)*2}',
    'E3 1 0 VALUE 2*V(1)',
    'E4 1 0 TABLE {V(a)} = (0,0) (1,1)',
    'E5 1 0 TABLE { V(1, 0) }  ( (-2 -7) (2 7) )',
    'E6 1 0 LAPLACE {V(a)} = {1/(1+s)}',
    'E7 1 0 FREQ {V(a)} = (0,0,0) (1k,-3,-45)',
    'E8 1 0 CHEBYSHEV {V(a)} = LP 800 1.2K .1dB 50dB',
    'E9 1 0 F = {V(a)}',
    'G1 1 0 Q = {V(a)}',
    'E10 1 0 POLY(1) (26,0) 0 500',
    'E11 1 0 a 0 10'
  ].join('\n') + '\n'), [
    'E1:E 1 0 P:VALUE={V(a)*2}',
    'E2:E 1 0 K:VALUE G:{V(a)*2}',
    'E3:E 1 0 K:VALUE 2*V(1)',
    'E4:E 1 0 K:TABLE P:{V(a)}=(0,0) G:(1,1)',
    'E5:E 1 0 K:TABLE G:{ V(1, 0) } G:( (-2 -7) (2 7) )',
    'E6:E 1 0 K:LAPLACE P:{V(a)}={1/(1+s)}',
    'E7:E 1 0 K:FREQ P:{V(a)}=(0,0,0) G:(1k,-3,-45)',
    'E8:E 1 0 K:CHEBYSHEV P:{V(a)}=LP 800 1.2K .1dB 50dB',
    'E9:E 1 0 P:F={V(a)}',
    'G1:G 1 0 P:Q={V(a)}',
    'E10:E 1 0 K:POLY(1) G:(26,0) 0 500',
    'E11:E 1 0 a 0 10'
  ]);
});

// --- Subcircuits (RG p.105–108, 329): OPTIONAL:, PARAMS: and TEXT: are words ------------------------

test('OPTIONAL:, PARAMS: and TEXT: are words, their assignments pairs, and a quoted text value is one group', () => {
  assert.deepEqual(cards('.SUBCKT 74LS00 A B Y OPTIONAL: DPWR=$G_DPWR DGND=$G_DGND PARAMS: MNTYMXDLY=0 IO_LEVEL=0\nX1 IN1 IN2 OUT 74LS00 PARAMS: X=1 TEXT: F="a b"\n.ENDS\n'), [
    '.subckt 74LS00 A B Y OPTIONAL: P:DPWR=$G_DPWR P:DGND=$G_DGND PARAMS: P:MNTYMXDLY=0 P:IO_LEVEL=0',
    'X1:X IN1 IN2 OUT 74LS00 PARAMS: P:X=1 TEXT: P:F="a b"',
    '.ends'
  ]);
});

// --- Quoting (RG p.13, 110–111): "…" strings and |…| text expressions; '…' is not a delimiter --------

test('"…" and |…| are groups that may hold spaces; \'…\' is ordinary text', () => {
  assert.deepEqual(cards('.INC "my models.lib"\n.TEXT F = |"ROM"+TEXTINT(RUN_NO)+".DAT"|\nU1 ROM(1,1) $G_DPWR $G_DGND en a o ROM_1 IO_STD FILE=|"ROM" + ".DAT"|\nV1 1 0 \'a b\'\n'), [
    '.inc G:"my models.lib"',
    '.text P:F=|"ROM"+TEXTINT(RUN_NO)+".DAT"|',
    'U1:U K:ROM(1,1) $G_DPWR $G_DGND en a o ROM_1 IO_STD P:FILE=|"ROM" + ".DAT"|',
    "V1:V 1 0 'a b'"
  ]);
});

// --- Bracketed node names (RG p.67, 272) and Probe output variables ---------------------------------

test('[SUB] is a word, and V([N1]) in a .PROBE line is one glued word', () => {
  assert.deepEqual(cards('Q7 VC 5 12 [SUB] LATPNP\n.PROBE64 V([N04173]) N(N03179)\n.IC V($G_VCC)=0.0;\n'), ['Q7:Q VC 5 12 [SUB] LATPNP', '.probe64 V([N04173]) N(N03179)', '.ic P:V($G_VCC)=0.0']);
});

// --- Models (RG p.58–62): AKO: and parenthesised parameters over continuation lines ------------------

test('.model keeps its name, an AKO: reference and its type; parameters are dropped but level', () => {
  assert.deepEqual(cards('.MODEL QDR2 AKO:QDRIV NPN (BF=100)\n.MODEL D1N3940 D(\n+ IS = 4E-10\n+ )\n.MODEL B1 NMOS (LEVEL=7 VERSION=3.1)\n.MODEL VSW VSWITCH(RON=1)\n'), [
    '.model QDR2 AKO:QDRIV NPN', '.model D1N3940 D', '.model B1 NMOS P:LEVEL=7', '.model VSW VSWITCH'
  ]);
});

// --- .ALIASES (RG p.34): an opaque region whose lines look like elements ----------------------------

test('.ALIASES … .ENDALIASES returns only its two directive cards', () => {
  assert.deepEqual(cards('R1 a 0 1k\n.ALIASES\nR_RBIAS RBIAS (1=$N_0001 2=VDD)\n_ _ (OUT=$N_0007)\n.ENDALIASES\nR2 a 0 2k\n'), ['R1:R a 0 1k', '.aliases', '.endaliases', 'R2:R a 0 2k']);
  assert.deepEqual(read('.ALIASES\n_ _ (OUT=1)\n').cards.map(compact), ['.aliases'], 'an unclosed block ends at the file');
});

// --- Several circuits in one file (RG p.44): the first .END ends the read ----------------------------

test('the first .END stops the read, and the lines of a second circuit are counted', () => {
  const output = read('R1 a 0 1k\n.END\n* second\nSecond circuit\nR2 a 0 1k\n.END\n');
  assert.deepEqual(output.cards.map(compact), ['R1:R a 0 1k', '.end']);
  assert.equal(output.afterEnd, 3);
});
