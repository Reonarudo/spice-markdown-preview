import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closure, MAX_FILES, MAX_TOTAL_BYTES, type CachedFile } from '../src/include-closure';
import { loadNgspice } from './helpers/ngspice';

before(loadNgspice);

const file = (text: string): CachedFile => ({ text, bytes: text.length, digest: `d:${text}` });

test('a fence with no includes is ready with no files', () => {
  assert.deepEqual(closure('R1 a 0 1', () => undefined), { status: 'ready', set: { files: {} }, identity: '' });
});

test('uncached files are asked for one level at a time', () => {
  const cache = new Map<string, CachedFile>();
  const first = closure('.include a.lib\n.lib b.lib tt', (key) => cache.get(key));
  assert.deepEqual(first, { status: 'missing', keys: ['a.lib', 'b.lib'] });
  cache.set('a.lib', file('.include sub/c.lib'));
  cache.set('b.lib', file('.lib tt\n.endl'));
  assert.deepEqual(closure('.include a.lib\n.lib b.lib tt', (key) => cache.get(key)), { status: 'missing', keys: ['sub/c.lib'] });
  cache.set('sub/c.lib', file('.model Q NPN'));
  const ready = closure('.include a.lib\n.lib b.lib tt', (key) => cache.get(key));
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.status === 'ready' && Object.keys(ready.set.files).sort(), ['a.lib', 'b.lib', 'sub/c.lib']);
});

test('a file that failed to load is passed on as an error, not asked for again', () => {
  const ready = closure('.include gone.lib', () => ({ error: 'the file does not exist', bytes: 0, digest: 'e' }));
  assert.deepEqual(ready.status === 'ready' && ready.set.files, { 'gone.lib': { error: 'the file does not exist' } });
});

test('the identity changes when any included file changes, and not otherwise', () => {
  const cache = new Map([['a.lib', file('.model Q NPN')]]);
  const once = closure('.include a.lib', (key) => cache.get(key));
  const again = closure('.include a.lib', (key) => cache.get(key));
  cache.set('a.lib', file('.model Q PNP'));
  const changed = closure('.include a.lib', (key) => cache.get(key));
  assert.ok(once.status === 'ready' && again.status === 'ready' && changed.status === 'ready');
  assert.equal(once.identity, again.identity);
  assert.notEqual(once.identity, changed.identity);
});

test('a cycle between files terminates', () => {
  const cache = new Map([['a.lib', file('.include b.lib')], ['b.lib', file('.include a.lib')]]);
  const result = closure('.include a.lib', (key) => cache.get(key));
  assert.equal(result.status, 'ready');
});

test('files past the count or size limits become errors the reader reports where they are used', () => {
  const many = Array.from({ length: MAX_FILES + 2 }, (_, i) => `.include f${i}.lib`).join('\n');
  const counted = closure(many, () => file('* empty'));
  assert.ok(counted.status === 'ready');
  assert.deepEqual(counted.set.files[`f${MAX_FILES}.lib`], { error: `a fence may include at most ${MAX_FILES} files` });
  const big: CachedFile = { text: '* big', bytes: MAX_TOTAL_BYTES / 2 + 1, digest: 'big' };
  const sized = closure('.include a.lib\n.include b.lib', () => big);
  assert.ok(sized.status === 'ready');
  assert.deepEqual(sized.set.files['b.lib'], { error: 'the included files exceed 16 MB together' });
});
