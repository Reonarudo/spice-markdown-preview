/**
 * Read the files that `.include` and `.lib` name, for the Markdown preview.
 *
 * Ported from the gnuplot-markdown-preview data loader (`src/documents.ts`, `src/dataLoader.ts`),
 * whose rules it keeps: files are read only in a trusted workspace, only for a saved Markdown
 * document inside a local workspace folder, only by paths relative to that document that stay
 * inside the folder, never through a symlink, and never over the size limits. Errors never
 * reveal an absolute path. See ADR 0004.
 *
 * Unlike gnuplot's, the cache holds files rather than rendered fences, so a fence resolves its
 * includes synchronously from the cache and typing in it never reloads anything.
 */
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { closure, type CachedFile } from './include-closure';
import { includeReferences } from './netlist';
import type { Includes } from './renderer';

/** A single included file may be this large: vendor model libraries run to several megabytes. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** All cached files together may be this large; the oldest are dropped beyond it. */
const MAX_CACHE_BYTES = 64 * 1024 * 1024;


export class IncludeFiles implements vscode.Disposable {
  /** Keyed by absolute path; Map order is load order, oldest first. */
  private readonly cache = new Map<string, CachedFile>();
  private readonly loading = new Set<string>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const changed = (uri: vscode.Uri): void => {
      console.log('[DEBUG-spice-watch] event', uri.fsPath, this.cache.has(uri.fsPath), this.loading.has(uri.fsPath));
      this.invalidate(uri);
    };
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
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.clear()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.clear()),
      vscode.commands.registerCommand('spice.refreshIncludes', () => this.clear())
    );
  }

  /**
   * The files a fence includes, when all are loaded; `undefined` while some are still loading,
   * in which case the preview is refreshed once they are. When files cannot be read here at all,
   * the set says why, and the fence draws without them.
   */
  prepare(source: string, env: unknown): Includes | undefined {
    if (includeReferences(source, '').length === 0) return { files: {}, identity: '' };
    const unavailable = (reason: string): Includes => ({ files: {}, unavailable: reason, identity: `unavailable:${reason}` });
    if (!vscode.workspace.isTrusted) return unavailable('files are read only in a trusted workspace');
    const document = (env as { currentDocument?: unknown } | undefined)?.currentDocument;
    if (!(document instanceof vscode.Uri) || document.scheme === 'untitled') {
      return unavailable('save the Markdown document in a workspace folder first');
    }
    const folder = vscode.workspace.getWorkspaceFolder(document);
    if (!folder) return unavailable('the Markdown document is not in a workspace folder');
    if (document.scheme !== 'file' || folder.uri.scheme !== 'file') {
      return unavailable('files are read only from a local folder');
    }
    const base = dirname(document.fsPath);
    const root = folder.uri.fsPath;
    const found = closure(source, (key) => this.touch(resolve(base, key)));
    if (found.status === 'ready') return { ...found.set, identity: `${base}\u0000${found.identity}` };
    for (const key of found.keys) void this.load(root, base, key);
    return undefined;
  }

  /** A cached file, marked most recently used. */
  private touch(path: string): CachedFile | undefined {
    const file = this.cache.get(path);
    if (file) {
      this.cache.delete(path);
      this.cache.set(path, file);
    }
    return file;
  }

  private async load(root: string, base: string, key: string): Promise<void> {
    const path = resolve(base, key);
    if (this.loading.has(path)) return;
    this.loading.add(path);
    let file: CachedFile;
    try {
      const text = await readContained(root, path);
      const bytes = Buffer.byteLength(text);
      file = { text, bytes, digest: createHash('sha256').update(text).digest('hex') };
    } catch (error) {
      const message = describe(error, root);
      file = { error: message, bytes: 0, digest: `error:${message}` };
    } finally {
      this.loading.delete(path);
    }
    if (this.disposed) return;
    console.log('[DEBUG-spice-watch] loaded', path, file);
    this.store(path, file);
    this.refresh();
  }

  private store(path: string, file: CachedFile): void {
    this.remove(path);
    this.cache.set(path, file);
    this.bytes += file.bytes;
    for (const [oldest, cached] of this.cache) {
      if (this.bytes <= MAX_CACHE_BYTES || oldest === path) break;
      this.bytes -= cached.bytes;
      this.cache.delete(oldest);
    }
  }

  private remove(path: string): boolean {
    const cached = this.cache.get(path);
    if (!cached) return false;
    this.bytes -= cached.bytes;
    this.cache.delete(path);
    return true;
  }

  /** Forget a changed file, or everything under a changed folder, and redraw what used it. */
  private invalidate(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;
    let changed = false;
    for (const path of [...this.cache.keys()]) {
      if (path === uri.fsPath || path.startsWith(uri.fsPath + sep)) changed = this.remove(path) || changed;
    }
    if (changed) this.refresh();
  }

  private clear(): void {
    this.cache.clear();
    this.bytes = 0;
    this.refresh();
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
    this.cache.clear();
  }
}

/** Whether `path` is strictly inside `root`. */
export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

class ReadError extends Error {}

/**
 * Read a text file that must lie inside `root`, reached through no symlink, no larger than the
 * limit — checked before the read and again after it, so that a file swapped mid-read is refused.
 */
async function readContained(root: string, path: string): Promise<string> {
  if (!inside(root, path)) throw new ReadError('it is outside the Markdown document’s workspace folder');
  const canonicalRoot = await realpath(root);
  const check = async (): Promise<void> => {
    let cursor = root;
    for (const part of relative(root, path).split(sep)) {
      cursor = resolve(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new ReadError('symlinked paths are not followed');
    }
    if (!inside(canonicalRoot, await realpath(path))) throw new ReadError('it resolves outside the workspace folder');
  };
  await check();
  const uri = vscode.Uri.file(path);
  const before = await vscode.workspace.fs.stat(uri);
  if (before.type !== vscode.FileType.File) throw new ReadError('it is not a file');
  if (before.size > MAX_FILE_BYTES) throw new ReadError(`it is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const bytes = await vscode.workspace.fs.readFile(uri);
  await check();
  const after = await vscode.workspace.fs.stat(uri);
  if (after.size !== before.size || after.mtime !== before.mtime || bytes.length > MAX_FILE_BYTES) {
    throw new ReadError('it changed while it was being read; save it again or run SPICE: Refresh Included Files');
  }
  if (bytes.includes(0)) throw new ReadError('it is not a text file');
  return new TextDecoder('utf-8').decode(bytes);
}

/** An author-facing reason, never carrying an absolute path from the host. */
function describe(error: unknown, root: string): string {
  if (error instanceof ReadError) return error.message;
  const code = (error as { code?: string }).code;
  if (code === 'ENOENT' || code === 'FileNotFound' || code === 'EntryNotFound') return 'the file does not exist';
  if (code === 'EACCES' || code === 'EPERM' || code === 'NoPermissions') return 'access is denied';
  if (code === 'EISDIR' || code === 'FileIsADirectory') return 'it is not a file';
  const message = error instanceof Error ? error.message : '';
  return message && !message.includes(root) && !message.includes(sep) ? message : 'the file is unavailable';
}
