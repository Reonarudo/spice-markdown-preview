import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import type { Prepared, RenderResult } from '@reonarudo/spice-renderer';
import { markdownPlugin } from './markdown';

export interface Preview {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
  /** Forget every cached outcome, so a cached timeout is retried. */
  clear(): void;
}

export interface PreviewOptions {
  /**
   * The render input for a fence read in `dialect`, `undefined` while it is being prepared, or a
   * message to show in its place.
   */
  prepare(source: string, env: unknown, dialect: string): Prepared | string | undefined;
  /**
   * The `spice.dialect` setting for the document being previewed, or `undefined` when it is unset
   * or not a dialect. A fence's own `dialect` attribute wins over it; without either, ngspice.
   */
  dialect?: (env: unknown) => string | undefined;
}

const DEFAULT_DIALECT = 'ngspice';
const MAX_RESULTS = 96;

/**
 * Assemble the preview: the result cache and the fence plugin. Kept free of `vscode` so it can be
 * exercised end to end in tests.
 *
 * The library does not cache (ADR 0003), and the preview re-renders the whole document on every
 * edit, so outcomes are kept here, keyed by the prepared input's identity — a digest of the fence,
 * its dialect and its included files. Timeouts are kept too: a circuit too large to lay out would
 * otherwise block the extension host for the whole budget on every keystroke. `unavailable` is
 * not kept: it says nothing about the netlist.
 *
 * `log` receives what never reaches the preview (ADR 0002): attribute diagnostics, and the
 * netlist reader's notes — once per fresh render, labelled with the fence's first line.
 */
export function createPreview(
  runtime: { render(input: Prepared): RenderResult },
  log: (line: string) => void,
  options: PreviewOptions
): Preview {
  const cache = new Map<string, RenderResult>();
  const render = (prepared: Prepared): RenderResult => {
    let result = cache.get(prepared.identity);
    if (result) {
      // Re-insert so Map order tracks recency and the first key is the least recently used.
      cache.delete(prepared.identity);
    } else {
      result = runtime.render(prepared);
      if (result.status === 'success') for (const note of result.notes) log(`${label(prepared.source)}: ${note}`);
      if (result.status === 'unavailable') return result;
    }
    cache.set(prepared.identity, result);
    if (cache.size > MAX_RESULTS) cache.delete(cache.keys().next().value!);
    return result;
  };
  return {
    extendMarkdownIt: (md) => markdownPlugin(md, (source, env, attributes) => {
      const dialect = attributes.dialect ?? options.dialect?.(env) ?? DEFAULT_DIALECT;
      const prepared = options.prepare(source, env, dialect);
      if (prepared === undefined) return undefined;
      if (typeof prepared === 'string') return { status: 'failure', message: prepared };
      return render(prepared);
    }, log),
    clear: () => cache.clear()
  };
}

function label(source: string): string {
  const first = source.trim().split('\n', 1)[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}
