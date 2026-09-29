import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRuntime } from '../src/renderer';

/** 200 resistors among 41 nodes: dense enough that ELK takes seconds, not milliseconds. */
const mesh = Array.from({ length: 200 }, (_, i) => `R${i} n${i % 37} n${(i * 7 + 3) % 41} 1k`).join('\n');

test('a netlist renders to a schematic through the worker, with the reader\'s notes', async () => {
  const runtime = await createRuntime(resolve('dist'));
  try {
    const result = runtime.render('V1 in 0 5\nR1 in out 1k\nQ1 out in 0 BC547\n.include models.lib');
    assert.equal(result.status, 'success');
    if (result.status !== 'success') return;
    assert.match(result.output, /^<svg class="spice"/);
    assert.match(result.output, />BC547<\/text>/);
    assert.deepEqual(result.notes, [
      'Line 4: .include models.lib is not read: no files are available here.',
      'Line 3: model BC547 of Q1 is not defined here; drawn as NPN.'
    ]);
  } finally {
    runtime.dispose();
  }
});

test('a netlist error comes back with its line and column', async () => {
  const runtime = await createRuntime(resolve('dist'));
  try {
    assert.deepEqual(runtime.render('R1 a b 1k\nD1 a'), { status: 'failure', message: 'D1 needs 2 nodes; found 1.', line: 2, column: 5 });
  } finally {
    runtime.dispose();
  }
});

test('a layout over the time limit times out, and the next render still works', async () => {
  const runtime = await createRuntime(resolve('dist'), { timeout: 200 });
  try {
    assert.deepEqual(runtime.render(mesh), { status: 'timeout', budget: 200 });
    const started = Date.now();
    assert.equal(runtime.render('R1 a 0 1k').status, 'success');
    assert.ok(Date.now() - started < 3000, 'a fresh worker starts well within its allowance');
  } finally {
    runtime.dispose();
  }
});

test('a budget function is read before every render', async () => {
  let budget = 100;
  const runtime = await createRuntime(resolve('dist'), { timeout: () => budget });
  try {
    assert.deepEqual(runtime.render(mesh), { status: 'timeout', budget: 100 });
    budget = 30_000;
    assert.equal(runtime.render(mesh).status, 'success');
  } finally {
    runtime.dispose();
  }
});

test('a netlist over 64 KB is refused before it reaches the worker', async () => {
  const runtime = await createRuntime(resolve('dist'));
  try {
    assert.deepEqual(runtime.render(`* ${'x'.repeat(64_000)}`), { status: 'failure', message: 'The netlist exceeds the 64 KB limit.' });
  } finally {
    runtime.dispose();
  }
});
