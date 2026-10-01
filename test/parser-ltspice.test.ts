/**
 * The vendored LTspice module against what LTspice 26.1 accepts, one case per finding of the
 * LTspice research (Redmine #1185) that changes how a line is cut into tokens. The module only
 * classifies (ADR 0008): these tests say which cards and tokens a line becomes, never what is
 * drawn — `test/netlist-ltspice.test.ts` does that.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALECTS } from '../src/catalogue/dialects';
import type { Card, ParserOutput, Token } from '../src/parser/contract';
import { parse } from '../src/parser/registry';
import { loadLtspice } from './helpers/ltspice';
import { checkDocument } from './helpers/parser-output';

before(loadLtspice);

/** Parse, check the contract, and return the document. */
function read(text: string): ParserOutput {
  const output = parse('ltspice', text);
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

// --- Comments (research 1, disagreements 1 and 2: only `*` and `;` comment; `$` and `//` are text) ----

test('a line whose first non-blank character is * is a comment, and ; starts a comment anywhere', () => {
  assert.deepEqual(cards('* C:\\circuits\\amp.asc\n  * indented\n; whole line\nR1 a b 1k ; trailing\nR2 a b 2k;glued\n'), ['R1:R a b 1k', 'R2:R a b 2k']);
});

test('$ is never a comment: $G_VDD is a node, and a $ after a blank is text', () => {
  assert.deepEqual(cards('R1 $G_VDD out 1k\nR2 a b 2k $ not a comment\nC1 $g_vss 0 1n\n'), ['R1:R $G_VDD out 1k', 'R2:R a b 2k $ not a comment', 'C1:C $g_vss 0 1n']);
});

test('// is not a comment: it stays inside a word, and a line starting with it is not an element', () => {
  assert.deepEqual(cards('R1 a b 3k//x\nR2 /in out 1k\n'), ['R1:R a b 3k//x', 'R2:R /in out 1k']);
  const found = error('R1 a b 1k\n// not a comment here\n');
  assert.equal(found.code, 'not-an-element');
  assert.deepEqual([found.line, found.found.text, found.cards], [2, '//', ['R1:R a b 1k']]);
});

// --- Continuation (research 2, disagreement 3: `+` only; no trailing `\\`) ----------------------------

test('+ continues the previous card, with comment and blank lines allowed between the pieces', () => {
  const output = read('V1 in 0\n* between\n\n+ PWL(0 0 1m 5)\n+ Rser=1\n');
  assert.deepEqual(output.cards.map(compact), ['V1:V in 0 PWL(0 0 1m 5) P:Rser=1']);
  assert.deepEqual(output.cards[0]!.tokens.map((t) => t.line), [1, 1, 4, 5]);
  assert.equal(error('V1 in 0 PWL(0 0\n+ 1m 5)\n').code, 'unterminated-group', 'a group must close on its line, as in every SPICE dialect');
});

test('a trailing \\\\ does not continue the line: it is a word, and the next line stands alone', () => {
  assert.deepEqual(read('R1 a b \\\\\n1k\n').cards.map(compact), ['R1:R a b \\\\']);
  assert.equal(error('R1 a b \\\\\n1k\n').code, 'not-an-element');
});

// --- Heads (research 5, disagreement 10: `@` and `&`; LTspice has no N, P or Y) ---------------------

test('every LTspice element letter opens an element card, upper-cased, @ and & included', () => {
  for (const letter of DIALECTS.ltspice.letters) {
    const lower = letter.toLowerCase();
    assert.deepEqual(cards(`${lower}1 a b c\n`), [`${lower}1:${letter} a b c`]);
  }
  assert.deepEqual(cards('@1 in out fstart=1 fend=1Meg\n&1 o+ o- i+ i-\n'), ['@1:@ in out P:fstart=1 P:fend=1Meg', '&1:& o+ o- i+ i-']);
});

test('N, P and Y are not LTspice elements', () => {
  for (const letter of ['N', 'P', 'Y']) {
    const found = error(`${letter}1 a b c\n`);
    assert.equal(found.code, 'not-an-element', letter);
    assert.equal(found.found.text, `${letter}1`);
  }
});

// --- Quoting (research 3: "…" strings with spaces, '…' and {…} expressions) --------------------------

test('"…" is a string that may hold spaces and comment characters, and \'…\' an expression: both are groups', () => {
  assert.deepEqual(cards('.lib "C:\\Program Files\\LTC\\lib\\sub\\LTC.lib"\n.include "my; models.lib"\n.param gain = \'2 * 3\'\nR1 a b {R * 2}\n'), [
    '.lib G:"C:\\Program Files\\LTC\\lib\\sub\\LTC.lib"',
    '.include G:"my; models.lib"',
    ".param P:gain='2 * 3'",
    'R1:R a b G:{R * 2}'
  ]);
});

test('a dynamic node {expr} is classified as a group, not a word', () => {
  assert.deepEqual(cards('R1 {n} 0 1k\n'), ['R1:R G:{n} 0 1k']);
});

// --- What an exported netlist carries (research 9) -------------------------------------------------

test('.backanno, .machine blocks and default .model cards are directives, and the first .end stops the read', () => {
  const output = read('* C:\\amp.asc\nR1 in out 1k\n.model D D\n.lib standard.dio\n.machine\n.state s0 0\n.rule s0 s0 V(in)*2 > 1\n.output (out) V(in)\n.endmachine\n.backanno\n.end\nR2 a 0 1\n');
  assert.deepEqual(output.cards.map(compact), [
    'R1:R in out 1k', '.model D D', '.lib standard.dio', '.machine', '.state s0 0', '.rule s0 s0 V(in) *2 > 1', '.output G:(out) V(in)', '.endmachine', '.backanno', '.end'
  ]);
  assert.equal(output.afterEnd, 1);
});

// --- Dependent sources (research 6, disagreements 6 and 7) -------------------------------------------

test('LTspice E/G shapes: value= is a pair, Laplace= and tbl=/table= are pairs after four nodes, POLY(n) is a keyword', () => {
  assert.deepEqual(cards([
    'E1 1 0 value={V(a)*2}',
    'G1 1 0 a 0 tbl=(0 0 1 1m)',
    'E2 1 0 a 0 table=(0,0,1,1)',
    'E3 1 0 a 0 Laplace=1/(1+s)',
    'E4 1 0 POLY(2) a 0 b 0 0 1 1',
    'F1 1 0 value={I(V1)}'
  ].join('\n') + '\n'), [
    'E1:E 1 0 P:value={V(a)*2}',
    'G1:G 1 0 a 0 P:tbl=(0 0 1 1m)',
    'E2:E 1 0 a 0 P:table=(0,0,1,1)',
    'E3:E 1 0 a 0 P:Laplace=1/(1+s)',
    'E4:E 1 0 K:POLY(2) a 0 b 0 0 1 1',
    'F1:F 1 0 P:value={I(V1)}'
  ]);
});
