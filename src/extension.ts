import type { ExtensionContext } from 'vscode';
import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import { Uri, window, workspace } from 'vscode';
import { createPreview } from './preview';
import { IncludeFiles } from './include-files';
import { parserLoader } from './parser/modules';
import { DEFAULT_DIALECT, DIALECT_NAMES, publicDialect, type PublicDialect } from './dialect';

export async function activate(context: ExtensionContext): Promise<{ extendMarkdownIt(md: MarkdownIt): MarkdownIt }> {
  // Unrecognised fence attributes and the netlist reader's notes never surface in the preview
  // (ADR 0002); they are reported here so an author who suspects a typo has somewhere to look.
  const channel = window.createOutputChannel('SPICE Schematic Preview');
  context.subscriptions.push(channel);
  // The host finds a fence's includes by reading it with the dialect's parser (ADR 0008), so each
  // dialect's module is loaded here too, beside the worker's own copy — the default one now, the
  // others at their first fence. A module that will not load is reported once; the worker reports
  // the same failure on every fence.
  const files = new IncludeFiles(parserLoader(context.asAbsolutePath('vendor/parsers')));
  context.subscriptions.push(files);
  const failure = await files.ensure(DEFAULT_DIALECT);
  if (failure) channel.appendLine(failure);
  const reported = new Set<string>();
  const preview = await createPreview(context.asAbsolutePath('dist'), (line) => channel.appendLine(line), {
    timeout: () => layoutTimeout(),
    includes: (source, env, dialect) => files.prepare(source, env, dialect),
    dialect: (env) => settingDialect(env, (note) => {
      // One note per bad value, not one per fence per keystroke.
      if (!reported.has(note)) channel.appendLine(note);
      reported.add(note);
    })
  });
  context.subscriptions.push({ dispose: () => preview.dispose() });
  // A cached timeout would otherwise outlive the budget it was measured against, and a cached
  // drawing the dialect it was read in.
  context.subscriptions.push(workspace.onDidChangeConfiguration((change) => {
    if (change.affectsConfiguration('spice.layoutTimeout') || change.affectsConfiguration('spice.dialect')) preview.clear();
  }));
  return { extendMarkdownIt: (md) => preview.extendMarkdownIt(md) };
}

/**
 * The `spice.dialect` setting as it applies to the previewed document, whose URI VS Code puts in
 * markdown-it's `env`; `undefined`, with a note, when the value is not a dialect.
 */
function settingDialect(env: unknown, note: (line: string) => void): PublicDialect | undefined {
  const document = (env as { currentDocument?: unknown } | undefined)?.currentDocument;
  const value = workspace.getConfiguration('spice', document instanceof Uri ? document : undefined).get<unknown>('dialect');
  if (value === undefined) return undefined;
  const dialect = publicDialect(value);
  if (!dialect) {
    note(`spice.dialect is ${JSON.stringify(value)}, which is not a dialect; reading as ${DEFAULT_DIALECT}. ` +
      `Choose one of ${DIALECT_NAMES.join(', ')}.`);
  }
  return dialect;
}

/** The configured budget in milliseconds, clamped to the range the setting declares. */
function layoutTimeout(): number {
  const seconds = workspace.getConfiguration('spice').get<number>('layoutTimeout', 3);
  const clamped = Number.isFinite(seconds) ? Math.min(60, Math.max(0.5, seconds)) : 3;
  return Math.round(clamped * 1000);
}
