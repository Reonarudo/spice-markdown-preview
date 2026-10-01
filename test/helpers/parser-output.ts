/**
 * Runtime checks of the parser output contract (ADR 0008, `src/parser/contract.ts`), shared by the
 * tests that run vendored modules: the shape, the token-class vocabulary, and positions that point
 * back into the parsed text.
 */
import assert from 'node:assert/strict';
import { CONTRACT, type Card, type ParserOutput, type Span, type Token } from '../../src/parser/contract';

export function checkDocument(output: ParserOutput, text: string, label: string): void {
  const lines = text.split(/\r?\n/);
  assert.equal(output.contract, CONTRACT, label);
  assert.ok(Array.isArray(output.cards), label);
  for (const card of output.cards) checkCard(card, lines, label);
  if (output.afterEnd !== undefined) {
    assert.ok(Number.isInteger(output.afterEnd) && output.afterEnd > 0, `${label}: afterEnd ${output.afterEnd}`);
  }
  if (output.error !== undefined) {
    const { error } = output;
    checkSpan(error, lines, label);
    assert.equal(typeof error.found.class, 'string', label);
    assert.equal(typeof error.found.text, 'string', label);
    assert.ok(Array.isArray(error.expected) && error.expected.length > 0, label);
    for (const name of error.expected) assert.match(name, /^[a-z][a-z -]*$/, `${label}: expected "${name}" is not a string alias`);
    if (error.code !== undefined) assert.match(error.code, /^[a-z][a-z-]*$/, `${label}: code "${error.code}"`);
  }
  const keys = Object.keys(output).sort();
  assert.deepEqual(keys.filter((key) => !['contract', 'cards', 'error', 'afterEnd'].includes(key)), [], `${label}: unknown keys ${keys}`);
}

export function checkCard(card: Card, lines: string[], label: string): void {
  checkSpan(card, lines, label);
  assert.ok(Array.isArray(card.tokens), label);
  if (card.kind === 'element') {
    assert.equal(typeof card.ref, 'string', label);
    assert.ok(card.ref.length > 0, label);
    assert.ok((card.letter === undefined) !== (card.master === undefined), `${label}: exactly one of letter and master`);
    if (card.letter !== undefined) assert.match(card.letter, /^[A-Z@&]$/, `${label}: letter "${card.letter}"`);
    if (card.selector !== undefined) assert.equal(typeof card.selector, 'string', label);
    if (card.nodesClosed !== undefined) assert.equal(card.nodesClosed, true, label);
  } else {
    assert.equal(card.kind, 'directive', label);
    assert.equal(card.name, card.name.toLowerCase(), `${label}: directive name "${card.name}" is lower-cased`);
  }
  for (const token of card.tokens) checkToken(token, lines, label);
}

export function checkToken(token: Token, lines: string[], label: string): void {
  checkSpan(token, lines, label);
  assert.ok(['word', 'pair', 'group', 'keyword'].includes(token.class), `${label}: token class "${token.class}"`);
  const written = lines[token.line - 1]!.slice(token.column, token.end);
  if (token.class === 'pair') {
    assert.equal(typeof token.key, 'string', label);
    assert.equal(typeof token.value, 'string', label);
    assert.equal(token.text, `${token.key}=${token.value}`, label);
    // `k = v` is written with spaces around `=`; the pair's text joins them, nothing else changes.
    assert.equal(written.replace(/\s*=\s*/, '='), token.text, `${label}: pair "${written}" at ${token.line}:${token.column}`);
  } else {
    assert.equal(token.key, undefined, label);
    assert.equal(token.value, undefined, label);
    assert.equal(written, token.text, `${label}: ${token.class} "${token.text}" at ${token.line}:${token.column}`);
  }
}

export function checkSpan(span: Span, lines: string[], label: string): void {
  assert.ok(Number.isInteger(span.line) && span.line >= 1 && span.line <= lines.length, `${label}: line ${span.line}`);
  assert.ok(Number.isInteger(span.column) && span.column >= 0, `${label}: column ${span.column}`);
  assert.ok(Number.isInteger(span.end) && span.end > span.column, `${label}: end ${span.end} after column ${span.column}`);
  assert.ok(span.end <= lines[span.line - 1]!.length, `${label}: end ${span.end} inside line ${span.line}`);
}
