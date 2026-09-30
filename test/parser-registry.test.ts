import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadParser, parse, type ParserFactory } from '../src/parser/registry';

const require = createRequire(import.meta.url);
const ngspice = require('../vendor/parsers/ngspice.cjs') as ParserFactory;

test('parsing in a dialect whose module was never loaded throws a plain error naming the dialect', () => {
  assert.throws(() => parse('hspice', 'R1 a b 1k\n'), (error: unknown) =>
    error instanceof Error && error.constructor === Error && /hspice/.test(error.message) && /not loaded/.test(error.message));
});

test('once a dialect is loaded, parse is synchronous and returns the contract document', async () => {
  await loadParser('ngspice', ngspice);
  const output = parse('ngspice', 'R1 in out 10k\n');
  assert.equal(output.contract, 1);
  assert.equal(output.cards.length, 1);
  const card = output.cards[0]!;
  assert.equal(card.kind, 'element');
  if (card.kind !== 'element') return;
  assert.equal(card.ref, 'R1');
  assert.equal(card.letter, 'R');
  assert.deepEqual(card.tokens.map((token) => token.text), ['in', 'out', '10k']);
  assert.equal(output.error, undefined);
});

/** A module standing in for one built against another version of the output shape. */
function moduleReturning(json: string, calls = { count: 0 }): ParserFactory {
  const encoder = new TextEncoder();
  const memory = new Map<number, string>();
  let next = 16;
  return async () => {
    calls.count++;
    return {
      lengthBytesUTF8: (text) => encoder.encode(text).length,
      _malloc: (bytes) => { const pointer = next; next += bytes; return pointer; },
      _free: (pointer) => { memory.delete(pointer); },
      stringToUTF8: (text, pointer) => { memory.set(pointer, text); },
      _netlist_parse: () => 1,
      UTF8ToString: (pointer) => (pointer === 1 ? json : memory.get(pointer) ?? '')
    };
  };
}

test('a module whose contract number differs is refused at load, naming the dialect and both numbers', async () => {
  await assert.rejects(loadParser('xyce', moduleReturning('{"contract":2,"cards":[]}')), (error: unknown) =>
    error instanceof Error && /xyce/.test(error.message) && /contract 2/.test(error.message) && /contract 1/.test(error.message));
  assert.throws(() => parse('xyce', ''), /not loaded/);
});

test('loading a dialect that is already loaded awaits no second factory', async () => {
  const calls = { count: 0 };
  const factory = moduleReturning('{"contract":1,"cards":[]}', calls);
  await loadParser('pspice', factory);
  await loadParser('pspice', factory);
  await loadParser('pspice', moduleReturning('{"contract":2,"cards":[]}', calls));
  assert.equal(calls.count, 1);
  assert.deepEqual(parse('pspice', 'anything'), { contract: 1, cards: [] });
});
