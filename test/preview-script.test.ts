// The pure core of media/preview.js, required exactly as shipped (docs/source-toggle-spec.md
// section 9.2). The DOM wiring is covered by the live run (scripts/test-preview.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Entry = { key: string; ordinal: number; index: number };
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
type Core = {
  match(entries: Entry[], keys: string[]): number[];
  collect(keys: string[], flipped: Iterable<number>): Entry[];
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

test('match: key first, then ordinal within the key group, then the same index among all fences', () => {
  const table: [string, Entry[], string[], number[]][] = [
    ['key present picks the ordinal within its group', [{ key: 'a', ordinal: 1, index: 0 }], ['a', 'b', 'a'], [2]],
    ['two identical bodies flipped independently', [{ key: 's', ordinal: 1, index: 1 }], ['s', 's'], [1]],
    ['both identical bodies flipped', [{ key: 's', ordinal: 0, index: 0 }, { key: 's', ordinal: 1, index: 1 }], ['s', 's'], [0, 1]],
    ['a key gone from the document falls back to the fence at the same index', [{ key: 'old', ordinal: 0, index: 2 }], ['a', 'b', 'c'], [2]],
    ['an index beyond the document drops the entry', [{ key: 'old', ordinal: 0, index: 5 }], ['a'], []],
    ['an ordinal beyond the key group drops the entry', [{ key: 'a', ordinal: 2, index: 0 }], ['a', 'a'], []],
    ['a fence inserted above a flipped one keeps the flip on the right fence', [{ key: 'b', ordinal: 0, index: 1 }], ['n', 'a', 'b'], [2]],
    ['a fence removed above a flipped one keeps the flip on the right fence', [{ key: 'b', ordinal: 0, index: 2 }], ['a', 'b'], [1]],
    ['nothing flipped matches nothing', [], ['a', 'b'], []],
    ['no fences left matches nothing', [{ key: 'a', ordinal: 0, index: 0 }], [], []]
  ];
  for (const [name, entries, keys, expected] of table) assert.deepEqual(core.match(entries, keys), expected, name);
});

test('collect describes only real fences, with ordinal and index recomputed from the document', () => {
  assert.deepEqual(core.collect(['a', 'b', 'a', 'c'], new Set([2, 3])), [
    { key: 'a', ordinal: 1, index: 2 },
    { key: 'c', ordinal: 0, index: 3 }
  ]);
  assert.deepEqual(core.collect(['a', 'b'], [7]), []);
  assert.deepEqual(core.collect([], [0]), []);
  // After a fallback match, collect re-keys the entry to the fence it now sits on.
  const after = ['x', 'y', 'z'];
  const flipped = core.match([{ key: 'old', ordinal: 0, index: 1 }], after);
  assert.deepEqual(core.collect(after, flipped), [{ key: 'y', ordinal: 0, index: 1 }]);
});

test('storageKey names the extension and the document', () => {
  assert.equal(core.storageKey('spice', 'file:///notes/model.md'), 'spice-markdown-preview.view-toggle:file:///notes/model.md');
});

test('save writes the entries, removes the key when nothing is flipped, and load reads them back', () => {
  const storage = memory();
  const entries = [{ key: 'a', ordinal: 0, index: 0 }];
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

test('a storage that throws degrades to memory-only: load is empty and save does not throw', () => {
  assert.deepEqual(core.load(throwing, 'k'), []);
  assert.doesNotThrow(() => core.save(throwing, 'k', [{ key: 'a', ordinal: 0, index: 0 }]));
  assert.doesNotThrow(() => core.save(throwing, 'k', []));
});
