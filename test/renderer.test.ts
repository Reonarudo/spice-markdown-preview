import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, type RenderResult } from '../src/renderer';

function stubRuntime(result: (source: string) => RenderResult = (source) =>
  ({ status: 'success', output: `<svg>${source}</svg>`, notes: [] })) {
  const seen: string[] = [];
  return { seen, render: (source: string) => { seen.push(source); return result(source); } };
}

test('a repeated netlist is laid out once, then served from the cache', () => {
  const runtime = stubRuntime();
  const render = createRenderer(runtime);
  assert.deepEqual(render('R1 a 0 1'), render('R1 a 0 1'));
  assert.deepEqual(runtime.seen, ['R1 a 0 1']);
});

test('timeouts and failures are cached; clearing retries them', () => {
  const runtime = stubRuntime(() => ({ status: 'timeout', budget: 3000 }));
  const render = createRenderer(runtime);
  render('big');
  render('big');
  assert.deepEqual(runtime.seen, ['big']);
  render.clear();
  render('big');
  assert.deepEqual(runtime.seen, ['big', 'big']);
});

test('an unavailable renderer is retried on the next render instead of being cached', () => {
  let starts = 0;
  const runtime = stubRuntime(() => ++starts === 1
    ? { status: 'unavailable', reason: 'boom' }
    : { status: 'success', output: '<svg></svg>', notes: [] });
  const render = createRenderer(runtime);
  assert.equal(render('a').status, 'unavailable');
  assert.equal(render('a').status, 'success');
});

test('onFresh hears each real render once, never a cache hit', () => {
  const heard: string[] = [];
  const render = createRenderer(stubRuntime(), (source) => heard.push(source));
  render('a');
  render('a');
  render('b');
  assert.deepEqual(heard, ['a', 'b']);
});

test('the cache keeps the 96 most recently used netlists', () => {
  const runtime = stubRuntime();
  const render = createRenderer(runtime);
  for (let i = 0; i < 96; i++) render(`n${i}`);
  render('n0');
  render('n96');
  runtime.seen.length = 0;
  render('n0');
  render('n2');
  render('n1');
  assert.deepEqual(runtime.seen, ['n1']);
});

test('the same netlist in another dialect is laid out again, not served from the cache', () => {
  const runtime = stubRuntime();
  const render = createRenderer(runtime);
  render('R1 a 0 1');
  render('R1 a 0 1', undefined, 'ngspice');
  render('R1 a 0 1', undefined, 'ltspice');
  render('R1 a 0 1', undefined, 'ltspice');
  assert.deepEqual(runtime.seen, ['R1 a 0 1', 'R1 a 0 1', 'R1 a 0 1']);
});
