import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { IncludeSet } from './netlist';
import type { DialectId } from './catalogue/types';

const capacity = 4_000_000;
const maxSource = 64_000;
const maxEntries = 96;

/** What drawing one netlist produced, as decoded from the worker. */
export type RenderResult =
  /** `notes` are what the netlist reader skipped or assumed, for the output channel. */
  | { status: 'success'; output: string; notes: string[] }
  /** A netlist error names the 1-based line and 0-based column it was found at. */
  | { status: 'failure'; message: string; line?: number; column?: number }
  | { status: 'timeout'; budget: number }
  | { status: 'unavailable'; reason: string };

/** What the host posts to the worker: the fence, the files it includes and the dialect it is read in. */
export interface Request {
  source: string;
  includes?: IncludeSet;
  /** Absent means ngspice, the default dialect. */
  dialect?: DialectId;
}

/** Included files with a cheap identity for the cache: equal identities mean equal files. */
export type Includes = IncludeSet & { identity: string };

export interface Runtime {
  render(source: string, includes?: IncludeSet, dialect?: DialectId): RenderResult;
  dispose(): void;
}

export interface RuntimeOptions {
  /** Per-schematic layout budget in milliseconds, or a function read before every render. */
  timeout?: number | (() => number);
  /** How long a fresh worker may take to load ELK before it is given up on. */
  startup?: number;
}

/**
 * Run the netlist reader, ELK and the drawing in a worker thread that the synchronous markdown-it
 * fence rule can block on.
 *
 * ELK's layered layout is superlinear in the number of parts and wires, so a large enough netlist
 * can take many seconds. A render that overruns its budget terminates the worker — the only way to
 * stop it mid-flight — and the next render spawns a fresh one, so one pathological circuit costs
 * only its own fence. `directory` is the extension's `dist/`, which holds `worker.js`.
 */
export async function createRuntime(directory: string, options: RuntimeOptions = {}): Promise<Runtime> {
  const { timeout = 3000, startup = 10000 } = options;
  const budgetFor = typeof timeout === 'function' ? timeout : () => timeout;
  let worker: Worker | undefined;
  let state: Int32Array;
  let bytes: Uint8Array;

  const spawn = (): Worker => {
    // Each worker gets its own buffer: a terminated worker still finishing a layout must not
    // be able to write its late answer where its replacement's answer is expected.
    const buffer = new SharedArrayBuffer(capacity + 12);
    state = new Int32Array(buffer, 0, 3);
    bytes = new Uint8Array(buffer, 12);
    worker = new Worker(join(directory, 'worker.js'), {
      workerData: { buffer },
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    // A crash surfaces to the waiting render as a timeout; this only keeps it from being fatal.
    worker.on('error', () => {});
    return worker;
  };
  const stop = (): void => {
    void worker?.terminate();
    worker = undefined;
  };

  // Warm the first worker so the first fence does not pay for loading the library. A failure
  // here is not fatal: the next render tries again with a fresh worker.
  const first = spawn();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, startup);
    function done(): void {
      clearTimeout(timer);
      first.off('message', done);
      first.off('error', done);
      resolve();
    }
    first.on('message', done);
    first.on('error', done);
  });

  return {
    render(source, includes, dialect) {
      if (source.length > maxSource) {
        return { status: 'failure', message: 'The netlist exceeds the 64 KB limit.' };
      }
      const current = worker ?? spawn();
      // Loading ELK is waited for separately, so the layout budget is the same for a
      // fresh worker as for a warm one and a timeout never becomes a 10 s stall.
      if (Atomics.load(state, 2) !== 1 && Atomics.wait(state, 2, 0, startup) === 'timed-out') {
        stop();
        return { status: 'unavailable', reason: `the layout worker did not start within ${startup / 1000} s` };
      }
      const budget = budgetFor();
      Atomics.store(state, 0, 0);
      const request: Request = { source };
      if (includes) request.includes = includes;
      if (dialect) request.dialect = dialect;
      current.postMessage(request);
      if (Atomics.wait(state, 0, 0, budget) === 'timed-out') {
        stop();
        return { status: 'timeout', budget };
      }
      const result = JSON.parse(new TextDecoder().decode(bytes.slice(0, Atomics.load(state, 1)))) as RenderResult;
      if (result.status === 'unavailable') stop();
      return result;
    },
    dispose: stop
  };
}

/**
 * Put a cache in front of the runtime, so re-rendering an unchanged fence on every keystroke costs
 * a lookup rather than a layout.
 *
 * Outcomes are cached, timeouts included: a circuit too large to lay out is not retried until its
 * netlist changes or the cache is cleared. An unavailable runtime says nothing about the netlist,
 * so it is not cached. `onFresh` hears every real render — never a cache hit — so notes are logged
 * once rather than on every keystroke.
 */
export interface Renderer {
  (source: string, includes?: Includes, dialect?: DialectId): RenderResult;
  /** Forget every outcome, so that cached timeouts are retried under a new budget. */
  clear(): void;
}

export function createRenderer(
  runtime: Pick<Runtime, 'render'>,
  onFresh: (source: string, result: RenderResult) => void = () => {}
): Renderer {
  const cache = new Map<string, RenderResult>();
  const render = (source: string, includes?: Includes, dialect?: DialectId): RenderResult => {
    // The included files are keyed by their identity, not their content: hashing megabytes of
    // model libraries on every keystroke would cost more than the cache saves.
    const key = createHash('sha256')
      .update(source).update('\u0000').update(includes?.identity ?? '').update('\u0000').update(dialect ?? '')
      .digest('hex');
    let result = cache.get(key);
    if (result) {
      // Re-insert so Map order tracks recency and the first key is the least recently used.
      cache.delete(key);
    } else {
      result = runtime.render(source, includes, dialect);
      onFresh(source, result);
      if (result.status === 'unavailable') return result;
    }
    cache.set(key, result);
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return result;
  };
  return Object.assign(render, { clear: () => cache.clear() });
}
