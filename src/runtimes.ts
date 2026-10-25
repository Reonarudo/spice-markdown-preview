import type { RenderInput, RenderResult, Runtime, RuntimeOptions } from '@reonarudo/spice-renderer';

export interface Library {
  createRuntime(options?: RuntimeOptions): Promise<Runtime>;
}

/** A library runtime that can be replaced by one with new options while the preview keeps rendering. */
export interface Restartable {
  render(input: RenderInput): RenderResult;
  /**
   * Start a runtime with `options` and, once it is ready, render through it and dispose of the old
   * one. Until then the old one keeps rendering. Of overlapping restarts, the last one wins.
   * Resolves `true` when this restart's runtime took over.
   */
  restart(options: RuntimeOptions): Promise<boolean>;
  dispose(): Promise<void>;
}

/**
 * The library takes its layout budget once, at `createRuntime` (ADR 0010), so a change to
 * `spice.layoutTimeout` means a fresh runtime rather than a new budget on the old one.
 */
export async function createRestartable(library: Library, options: RuntimeOptions): Promise<Restartable> {
  let current = await library.createRuntime(options);
  let generation = 0;
  let disposed = false;
  return {
    render: (input) => current.render(input),
    async restart(next) {
      const mine = ++generation;
      const runtime = await library.createRuntime(next);
      if (disposed || mine !== generation) {
        await runtime.dispose();
        return false;
      }
      const old = current;
      current = runtime;
      await old.dispose();
      return true;
    },
    async dispose() {
      disposed = true;
      await current.dispose();
    }
  };
}
