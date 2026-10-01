import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import { markdownPlugin } from './markdown';
import { createRenderer, createRuntime, type Includes } from './renderer';
import { chooseDialect, type PublicDialect } from './dialect';

export interface Preview {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
  /** Forget every cached drawing; call when the layout budget changes. */
  clear(): void;
  dispose(): void;
}

export interface PreviewOptions {
  /** Layout budget in milliseconds, read before every render. Default: 3000. */
  timeout?: () => number;
  /**
   * The files a fence includes, or `undefined` while they load. Without it, includes are noted
   * and skipped, as they are wherever files cannot be read.
   */
  includes?: (source: string, env: unknown, dialect: PublicDialect) => Includes | undefined;
  /**
   * The `spice.dialect` setting for the document being previewed, or `undefined` when it is unset
   * or not a dialect. A fence's own `dialect` attribute wins over it; without either, ngspice.
   */
  dialect?: (env: unknown) => PublicDialect | undefined;
}

const NO_FILES: Includes = { files: {}, unavailable: 'no files are available here', identity: 'none' };

/**
 * Assemble the preview: the layout worker, the cache, and the fence plugin. Kept free of `vscode`
 * so it can be exercised end to end in tests.
 *
 * `log` receives what never reaches the preview (ADR 0002): attribute diagnostics, and the
 * netlist reader's notes — once per fresh render, labelled with the fence's first line.
 */
export async function createPreview(
  distDirectory: string,
  log: (line: string) => void,
  options: PreviewOptions = {}
): Promise<Preview> {
  const runtime = await createRuntime(distDirectory, options.timeout ? { timeout: options.timeout } : {});
  const render = createRenderer(runtime, (source, result) => {
    if (result.status !== 'success') return;
    for (const note of result.notes) log(`${label(source)}: ${note}`);
  });
  return {
    extendMarkdownIt: (md) => markdownPlugin(md, (source, env, attributes) => {
      const dialect = chooseDialect(attributes.dialect, options.dialect?.(env));
      const includes = options.includes ? options.includes(source, env, dialect) : NO_FILES;
      return includes ? render(source, includes, dialect) : { status: 'loading' };
    }, log),
    clear: () => render.clear(),
    dispose: () => runtime.dispose()
  };
}

function label(source: string): string {
  const first = source.trim().split('\n', 1)[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}
