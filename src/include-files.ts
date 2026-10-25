/**
 * Prepare `spice` fences for the Markdown preview: read the netlist in its dialect and load the
 * files its `.include` and `.lib` cards name, through the renderer's `prepare` (ADR 0002).
 *
 * The editor's rules decide whether files may be read at all: only in a trusted workspace, only for
 * a saved Markdown document inside a local workspace folder (ADR 0004). Reading itself — paths
 * relative to the document that stay inside the folder, never through a symlink, never over the
 * size limits, never a file that changes mid-read — is the renderer's `nodeFileReader`, rooted at
 * that folder. Errors never reveal an absolute path.
 */
import * as vscode from 'vscode';
import { dirname, resolve, sep } from 'node:path';
import type { FileReader, Prepared } from '@reonarudo/spice-renderer';

/** What this module needs from spice-renderer, passed in because the library is loaded at activation. */
export interface Library {
  prepare: typeof import('@reonarudo/spice-renderer').prepare;
  nodeFileReader: typeof import('@reonarudo/spice-renderer').nodeFileReader;
}

interface Entry {
  readonly document: string;
  /** Absolute paths of every file the reader was asked for, found or not, so a watcher event can invalidate the entry. */
  readonly paths: Set<string>;
  bytes: number;
  prepared?: Prepared;
  error?: string;
}

/** All prepared fences' included files together may be this large: vendor model libraries run to megabytes. */
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_PENDING = 8;

/** A reader that refuses every file with one reason; netlists that include nothing never call it. */
const refuse = (error: string): FileReader => ({ read: async () => ({ error }) });

/**
 * The VS Code file reader adapter (ADR 0002 decision 5): the editor-only rules first, then the
 * library's reader rooted at the document's workspace folder.
 */
function readerFor(library: Library, document: vscode.Uri | undefined, record: (path: string) => void): FileReader {
  if (!vscode.workspace.isTrusted) return refuse('files are read only in a trusted workspace');
  if (!document || document.scheme === 'untitled') return refuse('save the Markdown document in a workspace folder first');
  const folder = vscode.workspace.getWorkspaceFolder(document)?.uri;
  if (!folder) return refuse('the Markdown document is not in a workspace folder');
  if (document.scheme !== 'file' || folder.scheme !== 'file') return refuse('files are read only from a local folder');
  const reader = library.nodeFileReader({ root: folder.fsPath, document: document.fsPath });
  return {
    async read(key, options) {
      record(resolve(dirname(document.fsPath), key));
      const result = await reader.read(key, options);
      // The library's wording is about a site's content root; here the root is the workspace folder.
      return 'error' in result && result.error === 'the file is outside the content root'
        ? { error: 'it is outside the Markdown document’s workspace folder' }
        : result;
    }
  };
}

function currentDocument(env: unknown): vscode.Uri | undefined {
  const candidate = (env as { currentDocument?: unknown } | undefined)?.currentDocument;
  return candidate instanceof vscode.Uri ? candidate : undefined;
}

/**
 * Prepared render inputs per document, dialect and fence body. `prepare` is asynchronous and the
 * fence rule is not (ADR 0010 decision 4): a fence seen for the first time starts preparing and is
 * reported as not ready, and the preview is refreshed once it settles.
 */
export class IncludeFiles implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private bytes = 0;
  private pending = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly library: Library) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const changed = (uri: vscode.Uri): void => this.invalidate(uri);
    this.subscriptions.push(
      watcher,
      watcher.onDidChange(changed),
      watcher.onDidCreate(changed),
      watcher.onDidDelete(changed),
      vscode.workspace.onDidSaveTextDocument((document) => changed(document.uri)),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const file of event.files) {
          changed(file.oldUri);
          changed(file.newUri);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        for (const [key, entry] of this.entries) if (entry.document === document.uri.toString()) this.remove(key);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.clear()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.clear())
    );
  }

  /**
   * The render input for a fence read in `dialect`, `undefined` while it is being prepared, or a
   * message when the cache of included files is full.
   */
  prepare(source: string, env: unknown, dialect: string): Prepared | string | undefined {
    const document = currentDocument(env);
    const key = JSON.stringify([document?.toString() ?? '', dialect, source]);
    const found = this.entries.get(key);
    if (found) {
      // Re-insert so Map order tracks recency and the first key is the least recently used.
      this.entries.delete(key);
      this.entries.set(key, found);
      return found.error ?? found.prepared;
    }
    if (this.pending >= MAX_PENDING) {
      this.refresh();
      return undefined;
    }
    if (this.entries.size >= MAX_ENTRIES) this.remove(this.entries.keys().next().value!);

    const entry: Entry = { document: document?.toString() ?? '', paths: new Set(), bytes: 0 };
    this.entries.set(key, entry);
    this.pending++;
    const reader = readerFor(this.library, document, (path) => entry.paths.add(path));
    void this.library.prepare(source, { reader, dialect }).then((prepared) => {
      if (this.disposed || this.entries.get(key) !== entry) return;
      const bytes = prepared.files.reduce((sum, file) => sum + ('text' in file ? file.text.length : 0), 0);
      if (this.bytes + bytes > MAX_CACHE_BYTES) {
        entry.error = 'The included files of open documents exceed the 64 MiB cache. ' +
          'Close unused Markdown documents and run SPICE: Refresh Included Files.';
        return;
      }
      entry.bytes = bytes;
      this.bytes += bytes;
      entry.prepared = prepared;
    }, (error: unknown) => {
      // `prepare` rejects only for programmer errors; this fence alone shows it.
      if (this.entries.get(key) === entry) entry.error = error instanceof Error ? error.message : 'The netlist could not be prepared.';
    }).finally(() => {
      this.pending--;
      this.refresh();
    });
    return undefined;
  }

  /** Forget every prepared fence, so included files are read again, and redraw. */
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.refresh();
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }

  /** Forget the fences that read a changed file, or anything under a changed folder, and redraw them. */
  private invalidate(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;
    let changed = false;
    for (const [key, entry] of this.entries) {
      if ([...entry.paths].some((path) => path === uri.fsPath || path.startsWith(uri.fsPath + sep))) {
        this.remove(key);
        changed = true;
      }
    }
    if (changed) this.refresh();
  }

  /** Ask open previews to render again, at most once per burst of loads. */
  private refresh(): void {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void vscode.commands.executeCommand('markdown.preview.refresh').then(undefined, () => {});
    }, 100);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
    this.entries.clear();
    this.bytes = 0;
  }
}
