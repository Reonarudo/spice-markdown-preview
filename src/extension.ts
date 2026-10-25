import type { ExtensionContext } from 'vscode';
import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import { commands, Uri, window, workspace } from 'vscode';
import { createPreview, type Preview } from './preview';
import { IncludeFiles } from './include-files';
import { createRestartable, type Restartable } from './runtimes';

let runtime: Restartable | undefined;

export async function activate(context: ExtensionContext): Promise<{ extendMarkdownIt(md: MarkdownIt): MarkdownIt }> {
  // Unrecognised fence attributes and the netlist reader's notes never surface in the preview
  // (ADR 0002); they are reported here so an author who suspects a typo has somewhere to look.
  const channel = window.createOutputChannel('SPICE Schematic Preview');
  context.subscriptions.push(channel);
  const log = (line: string) => channel.appendLine(line);

  let preview: Preview;
  try {
    // Required here, not imported, so that a library that fails to load lands in this `try`
    // instead of failing activation. esbuild leaves it external (ADR 0010).
    const library: typeof import('@reonarudo/spice-renderer') = require('@reonarudo/spice-renderer');
    const started = await createRestartable(library, { timeout: layoutTimeout() });
    runtime = started;
    const files = new IncludeFiles(library);
    context.subscriptions.push(files);
    const reported = new Set<string>();
    preview = createPreview(started, log, {
      prepare: (source, env, dialect) => files.prepare(source, env, dialect),
      dialect: (env) => settingDialect(library.DIALECT_NAMES, env, (note) => {
        // One note per bad value, not one per fence per keystroke.
        if (!reported.has(note)) log(note);
        reported.add(note);
      })
    });
    context.subscriptions.push(
      commands.registerCommand('spice.refreshIncludes', () => {
        // Doubles as "retry": a cached timeout is forgotten along with the files.
        preview.clear();
        files.clear();
      }),
      workspace.onDidChangeConfiguration((change) => {
        if (!change.affectsConfiguration('spice.layoutTimeout')) return;
        // The old runtime lays out until the new one is ready; then cached timeouts, measured
        // against the old budget, are forgotten.
        started.restart({ timeout: layoutTimeout() }).then(
          (tookOver) => { if (tookOver) preview.clear(); },
          (error) => log(`SPICE renderer failed to restart: ${describe(error)}`)
        );
      })
    );
  } catch (error) {
    log(`SPICE renderer failed to load: ${describe(error)}`);
    // Every fence renders as unavailable; nothing is prepared, and `unavailable` is never cached.
    preview = createPreview({
      render: () => ({ status: 'unavailable', reason: 'the renderer failed to load; see the "SPICE Schematic Preview" output' })
    }, log, {
      prepare: (source) => ({ source, dialect: 'ngspice', files: [], identity: '' })
    });
  }
  return { extendMarkdownIt: (md) => preview.extendMarkdownIt(md) };
}

export async function deactivate(): Promise<void> {
  await runtime?.dispose();
  runtime = undefined;
}

/**
 * The `spice.dialect` setting as it applies to the previewed document, whose URI VS Code puts in
 * markdown-it's `env`; `undefined`, with a note, when the value is not a dialect.
 */
function settingDialect(names: readonly string[], env: unknown, note: (line: string) => void): string | undefined {
  const document = (env as { currentDocument?: unknown } | undefined)?.currentDocument;
  const value = workspace.getConfiguration('spice', document instanceof Uri ? document : undefined).get<unknown>('dialect');
  if (value === undefined) return undefined;
  const name = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  if (name !== undefined && names.includes(name)) return name;
  note(`spice.dialect is ${JSON.stringify(value)}, which is not a dialect; reading as ngspice. ` +
    `Choose one of ${names.join(', ')}.`);
  return undefined;
}

/** The configured budget in milliseconds, clamped to the range the setting declares. */
function layoutTimeout(): number {
  const seconds = workspace.getConfiguration('spice').get<number>('layoutTimeout', 3);
  const clamped = Number.isFinite(seconds) ? Math.min(60, Math.max(0.5, seconds)) : 3;
  return Math.round(clamped * 1000);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
