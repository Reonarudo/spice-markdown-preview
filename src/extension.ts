import type { ExtensionContext } from 'vscode';
import type MarkdownItConstructor from 'markdown-it';
type MarkdownIt = InstanceType<typeof MarkdownItConstructor>;
import { window, workspace } from 'vscode';
import { createPreview } from './preview';
import { IncludeFiles } from './include-files';
import { parserLoader } from './parser/modules';

export async function activate(context: ExtensionContext): Promise<{ extendMarkdownIt(md: MarkdownIt): MarkdownIt }> {
  // Unrecognised fence attributes and the netlist reader's notes never surface in the preview
  // (ADR 0002); they are reported here so an author who suspects a typo has somewhere to look.
  const channel = window.createOutputChannel('SPICE Schematic Preview');
  context.subscriptions.push(channel);
  // The host finds a fence's includes by reading it with the dialect's parser (ADR 0008), so the
  // default dialect's module is loaded here, beside the worker's own copy. A module that will not
  // load is reported once; the worker reports the same failure on every fence.
  try {
    await parserLoader(context.asAbsolutePath('vendor/parsers'))('ngspice');
  } catch (error) {
    channel.appendLine(error instanceof Error ? error.message : String(error));
  }
  const files = new IncludeFiles();
  context.subscriptions.push(files);
  const preview = await createPreview(context.asAbsolutePath('dist'), (line) => channel.appendLine(line), {
    timeout: () => layoutTimeout(),
    includes: (source, env) => files.prepare(source, env)
  });
  context.subscriptions.push({ dispose: () => preview.dispose() });
  // A cached timeout would otherwise outlive the budget it was measured against.
  context.subscriptions.push(workspace.onDidChangeConfiguration((change) => {
    if (change.affectsConfiguration('spice.layoutTimeout')) preview.clear();
  }));
  return { extendMarkdownIt: (md) => preview.extendMarkdownIt(md) };
}

/** The configured budget in milliseconds, clamped to the range the setting declares. */
function layoutTimeout(): number {
  const seconds = workspace.getConfiguration('spice').get<number>('layoutTimeout', 3);
  const clamped = Number.isFinite(seconds) ? Math.min(60, Math.max(0.5, seconds)) : 3;
  return Math.round(clamped * 1000);
}
