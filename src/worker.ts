import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import ELK from 'elkjs/lib/elk.bundled.js';
import symbolsSvg from './skin/symbols.svg';
import { loadSymbols } from './schematic';
import { renderNetlist } from './draw-netlist';
import { parserLoader } from './parser/modules';
import type { RenderResult, Request } from './renderer';

const { buffer } = workerData as { buffer: SharedArrayBuffer };
/** [0] result ready, [1] result byte length, [2] 1 once ELK has loaded and this worker listens. */
const state = new Int32Array(buffer, 0, 3);
const bytes = new Uint8Array(buffer, 12);

function reply(result: RenderResult): void {
  let encoded = new TextEncoder().encode(JSON.stringify(result));
  if (encoded.length > bytes.length) {
    encoded = new TextEncoder().encode(JSON.stringify({
      status: 'failure',
      message: 'The schematic exceeds the 4 MB limit.'
    } satisfies RenderResult));
  }
  bytes.set(encoded);
  Atomics.store(state, 1, encoded.length);
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
}

const symbols = loadSymbols(symbolsSvg);
const elk = new ELK();
const layout = (graph: Parameters<typeof elk.layout>[0]) => elk.layout(graph);
// This file runs as `dist/worker.js`, beside the `vendor/` the VSIX ships (ADR 0008).
const loadParser = parserLoader(join(__dirname, '..', 'vendor', 'parsers'));

/**
 * Draw one request. The dialect's parser is loaded the first time a fence in that dialect
 * arrives; a module that will not load is reported like a netlist error, not left to kill the
 * worker — the author sees why, and the next fence is drawn.
 */
async function render({ source, includes, dialect = 'ngspice' }: Request): Promise<RenderResult> {
  try {
    await loadParser(dialect);
  } catch (error) {
    return { status: 'failure', message: error instanceof Error ? error.message : String(error) };
  }
  return renderNetlist(source, symbols, layout, includes, dialect);
}

// The first layout in a fresh worker costs a few hundred milliseconds of warm-up that must not be
// charged to an author's budget, so it is spent here, before this worker reports ready. The
// warm-up is an ngspice netlist, so the default dialect's parser is loaded along with it.
void render({ source: 'V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\nQ1 out in 0 npn\nM1 out in 0 0 nmos\nX1 in out box' })
  .finally(() => {
    parentPort!.on('message', (request: Request) => {
      render(request).then(reply, (error: unknown) => {
        reply({ status: 'failure', message: error instanceof Error ? error.message : String(error) });
      });
    });
    Atomics.store(state, 2, 1);
    Atomics.notify(state, 2);
    parentPort!.postMessage({ ready: true });
  });
