// The pure core of media/preview.js, required exactly as shipped (docs/source-toggle-spec.md
// section 9.2, amended by docs/bom-view-spec.md section 9). The DOM wiring is covered by the live
// run (scripts/test-preview.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

type View = 'source' | 'bom';
type Entry = { key: string; ordinal: number; index: number; view: View };
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
type Core = {
  match(entries: Entry[], keys: string[]): Map<number, View>;
  collect(keys: string[], views: Map<number, View>): Entry[];
  storageKey(base: string, uri: string): string;
  load(storage: Storage, key: string): Entry[];
  save(storage: Storage, key: string, entries: Entry[]): void;
};
const core: Core = require('../media/preview.js');

const memory = (): Storage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); }
  };
};
const throwing: Storage = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
  removeItem: () => { throw new Error('SecurityError'); }
};

test('requiring the shipped script under Node exports the core and runs no DOM wiring', () => {
  for (const name of ['match', 'collect', 'storageKey', 'load', 'save'] as const) assert.equal(typeof core[name], 'function', name);
});

const source = (key: string, ordinal: number, index: number): Entry => ({ key, ordinal, index, view: 'source' });
const bom = (key: string, ordinal: number, index: number): Entry => ({ key, ordinal, index, view: 'bom' });
const views = (...pairs: [number, View][]) => new Map(pairs);

test('match: key first, then ordinal within the key group, then the same index among all fences', () => {
  const table: [string, Entry[], string[], Map<number, View>][] = [
    ['key present picks the ordinal within its group', [source('a', 1, 0)], ['a', 'b', 'a'], views([2, 'source'])],
    ['two identical bodies flipped independently', [source('s', 1, 1)], ['s', 's'], views([1, 'source'])],
    ['both identical bodies flipped', [source('s', 0, 0), source('s', 1, 1)], ['s', 's'], views([0, 'source'], [1, 'source'])],
    ['a key gone from the document falls back to the fence at the same index', [source('old', 0, 2)], ['a', 'b', 'c'], views([2, 'source'])],
    ['an index beyond the document drops the entry', [source('old', 0, 5)], ['a'], views()],
    ['an ordinal beyond the key group drops the entry', [source('a', 2, 0)], ['a', 'a'], views()],
    ['a fence inserted above a flipped one keeps the flip on the right fence', [source('b', 0, 1)], ['n', 'a', 'b'], views([2, 'source'])],
    ['a fence removed above a flipped one keeps the flip on the right fence', [source('b', 0, 2)], ['a', 'b'], views([1, 'source'])],
    ['nothing flipped matches nothing', [], ['a', 'b'], views()],
    ['no fences left matches nothing', [source('a', 0, 0)], [], views()],
    ['two identical bodies keep their own views', [bom('s', 0, 0), source('s', 1, 1)], ['s', 's'], views([0, 'bom'], [1, 'source'])],
    ['a later entry for the same position wins', [source('a', 0, 0), bom('a', 0, 0)], ['a'], views([0, 'bom'])]
  ];
  for (const [name, entries, keys, expected] of table) assert.deepEqual(core.match(entries, keys), expected, name);
});

test('collect describes only real fences, with ordinal, index and view recomputed from the document', () => {
  assert.deepEqual(core.collect(['a', 'b', 'a', 'c'], views([2, 'source'], [3, 'bom'])), [
    source('a', 1, 2),
    bom('c', 0, 3)
  ]);
  assert.deepEqual(core.collect(['a', 'b'], views([7, 'source'])), []);
  assert.deepEqual(core.collect([], views([0, 'bom'])), []);
  // After a fallback match, collect re-keys the entry to the fence it now sits on.
  const after = ['x', 'y', 'z'];
  const flipped = core.match([bom('old', 0, 1)], after);
  assert.deepEqual(core.collect(after, flipped), [bom('y', 0, 1)]);
});

test('a bom entry round-trips through collect and match', () => {
  const keys = ['a', 'b', 'a'];
  const entries = core.collect(keys, views([2, 'bom']));
  assert.deepEqual(entries, [bom('a', 1, 2)]);
  assert.deepEqual(core.match(entries, keys), views([2, 'bom']));
});

test('storageKey names the extension and the document', () => {
  assert.equal(core.storageKey('spice', 'file:///notes/model.md'), 'spice-markdown-preview.view-toggle:file:///notes/model.md');
});

test('save writes the entries, removes the key when nothing is flipped, and load reads them back', () => {
  const storage = memory();
  const entries = [source('a', 0, 0), bom('b', 0, 1)];
  core.save(storage, 'k', entries);
  assert.equal(storage.map.get('k'), JSON.stringify(entries));
  assert.deepEqual(core.load(storage, 'k'), entries);
  core.save(storage, 'k', []);
  assert.equal(storage.map.has('k'), false);
  assert.deepEqual(core.load(storage, 'k'), []);
});

test('load ignores a missing, corrupt or wrongly shaped value', () => {
  const storage = memory();
  assert.deepEqual(core.load(storage, 'k'), []);
  storage.map.set('k', '{not json');
  assert.deepEqual(core.load(storage, 'k'), []);
  storage.map.set('k', '{"key":"a"}');
  assert.deepEqual(core.load(storage, 'k'), []);
});

test('load migrates a 0.4.0 entry without a view to source, and drops unknown views and malformed entries', () => {
  const storage = memory();
  storage.map.set('k', JSON.stringify([
    { key: 'a', ordinal: 0, index: 0 },
    { key: 'b', ordinal: 0, index: 1, view: 'bom' },
    { key: 'c', ordinal: 0, index: 2, view: 'table' },
    { key: 'd', ordinal: 0, view: 'source' },
    { key: 5, ordinal: 0, index: 4 },
    null,
    'e',
    { key: 'f', ordinal: 0, index: 5, view: 'source', extra: true }
  ]));
  assert.deepEqual(core.load(storage, 'k'), [source('a', 0, 0), bom('b', 0, 1), source('f', 0, 5)]);
});

test('a storage that throws degrades to memory-only: load is empty and save does not throw', () => {
  assert.deepEqual(core.load(throwing, 'k'), []);
  assert.doesNotThrow(() => core.save(throwing, 'k', [source('a', 0, 0)]));
  assert.doesNotThrow(() => core.save(throwing, 'k', []));
});
