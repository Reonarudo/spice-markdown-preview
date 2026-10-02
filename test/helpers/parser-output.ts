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
    assert.equal(error.endLine, undefined, `${label}: an error's span lies on one line`);
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
  assert.equal(card.endLine, undefined, `${label}: a card's span is its head token's, on one line`);
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
  if (token.class === 'pair') {
    assert.equal(typeof token.key, 'string', label);
    assert.equal(typeof token.value, 'string', label);
    assert.equal(token.text, `${token.key}=${token.value}`, label);
  } else {
    assert.equal(token.key, undefined, label);
    assert.equal(token.value, undefined, label);
  }
  // `k = v` is written with spaces around `=`; the pair's text joins them, nothing else changes.
  const joined = (written: string): string => (token.class === 'pair' ? written.replace(/\s*=\s*/, '=') : written);
  const where = `${token.line}:${token.column}`;
  if (token.endLine === undefined) {
    assert.equal(joined(lines[token.line - 1]!.slice(token.column, token.end)), token.text, `${label}: ${token.class} "${token.text}" at ${where}`);
    return;
  }
  // Continued across lines — a `+` line, or (Spectre) a line ending in `\`: the text starts with the first line's
  // piece without the backslash, ends with the last line's piece after its `+`, and joins the pieces with one blank
  // where the break was. The lines between are not part of it.
  const head = joined(lines[token.line - 1]!.slice(token.column)).replace(/\s*\\\s*$/, '').trimEnd();
  const tail = lines[token.endLine - 1]!.slice(0, token.end).replace(/^\s*\+\s*/, '').trimStart();
  assert.ok(token.text.startsWith(head), `${label}: ${token.class} "${token.text}" at ${where} starts with "${head}"`);
  assert.ok(token.text.endsWith(tail), `${label}: ${token.class} "${token.text}" at ${where} ends with "${tail}" on line ${token.endLine}`);
  // A pair split at its `=` (`r=` then `+ 1k`) joins directly; a group's pieces are joined by one blank.
  if (!head.endsWith('=')) assert.equal(token.text.slice(head.length)[0], ' ', `${label}: the pieces of "${token.text}" are joined by a blank`);
}

export function checkSpan(span: Span, lines: string[], label: string): void {
  assert.ok(Number.isInteger(span.line) && span.line >= 1 && span.line <= lines.length, `${label}: line ${span.line}`);
  assert.ok(Number.isInteger(span.column) && span.column >= 0, `${label}: column ${span.column}`);
  if (span.endLine === undefined) {
    assert.ok(Number.isInteger(span.end) && span.end > span.column, `${label}: end ${span.end} after column ${span.column}`);
    assert.ok(span.end <= lines[span.line - 1]!.length, `${label}: end ${span.end} inside line ${span.line}`);
  } else {
    // A span that runs onto a later line: `end` is a column on `endLine`, and `endLine` is never the start line itself.
    assert.ok(Number.isInteger(span.endLine) && span.endLine > span.line && span.endLine <= lines.length, `${label}: endLine ${span.endLine} after line ${span.line}`);
    assert.ok(Number.isInteger(span.end) && span.end > 0 && span.end <= lines[span.endLine - 1]!.length, `${label}: end ${span.end} inside line ${span.endLine}`);
  }
}
