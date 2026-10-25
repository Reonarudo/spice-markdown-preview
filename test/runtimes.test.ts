import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prepared, RenderResult, Runtime, RuntimeOptions } from '@reonarudo/spice-renderer';
import { createRestartable } from '../src/runtimes';

/** A library whose runtimes report the budget they were made with, and whose starts we release by hand. */
function fakeLibrary() {
  const made: { options: RuntimeOptions; disposed: boolean }[] = [];
  const pending: (() => void)[] = [];
  let hold = false;
  return {
    made,
    hold: (on: boolean) => { hold = on; },
    release: () => pending.splice(0).forEach((go) => go()),
    async createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
      const record = { options, disposed: false };
      made.push(record);
      if (hold) await new Promise<void>((resolve) => pending.push(resolve));
      return {
        render: (): RenderResult => ({ status: 'timeout', budget: options.timeout! }),
        dispose: async () => { record.disposed = true; }
      };
    }
  };
}

const budget = (result: RenderResult) => result.status === 'timeout' ? result.budget : undefined;
const input: Prepared = { source: 'R1 a 0 1k', dialect: 'ngspice', files: [], identity: '0'.repeat(64) };

test('a restart renders through the new runtime once it is ready, and disposes of the old one', async () => {
  const library = fakeLibrary();
  const runtime = await createRestartable(library, { timeout: 1000 });
  library.hold(true);
  const restarting = runtime.restart({ timeout: 2000 });
  assert.equal(budget(runtime.render(input)), 1000, 'the old runtime renders while the new one starts');
  library.release();
  assert.equal(await restarting, true);
  assert.equal(budget(runtime.render(input)), 2000);
  assert.deepEqual(library.made.map((m) => m.disposed), [true, false]);
});

test('of overlapping restarts the last one wins, and the loser is disposed of', async () => {
  const library = fakeLibrary();
  const runtime = await createRestartable(library, { timeout: 1000 });
  library.hold(true);
  const first = runtime.restart({ timeout: 2000 });
  const second = runtime.restart({ timeout: 3000 });
  library.release();
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.equal(budget(runtime.render(input)), 3000);
  assert.deepEqual(library.made.map((m) => m.disposed), [true, true, false]);
});

test('a restart that finishes after dispose is disposed of too', async () => {
  const library = fakeLibrary();
  const runtime = await createRestartable(library, { timeout: 1000 });
  library.hold(true);
  const restarting = runtime.restart({ timeout: 2000 });
  await runtime.dispose();
  library.release();
  assert.equal(await restarting, false);
  assert.deepEqual(library.made.map((m) => m.disposed), [true, true]);
});
