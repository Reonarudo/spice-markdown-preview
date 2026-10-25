import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as library from '@reonarudo/spice-renderer';
import type { FileReader, Prepared } from '@reonarudo/spice-renderer';

const compiled = buildSync({
  entryPoints: ['src/include-files.ts'], bundle: true, platform: 'node', format: 'cjs',
  external: ['vscode', '@reonarudo/spice-renderer'], write: false
}).outputFiles[0]!.text;
class Uri {
  constructor(readonly fsPath: string, readonly scheme = 'file') {}
  toString() { return this.scheme + ':' + this.fsPath; }
  static file(path: string) { return new Uri(path); }
}
type Files = { prepare(source: string, env: unknown, dialect: string): Prepared | string | undefined; clear(): void; dispose(): void };
const settle = async (files: Files, source: string, env: unknown, dialect = 'ngspice') => {
  for (let i = 0; i < 100; i++) {
    const prepared = files.prepare(source, env, dialect);
    if (prepared !== undefined) return prepared;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('never prepared');
};
/** The error the netlist reader will report at the fence's include, or `undefined`. */
const unread = (prepared: Prepared | string) => typeof prepared === 'string'
  ? prepared
  : prepared.failure?.message ?? prepared.files.find((file) => 'error' in file)?.['error' as never];

test('the adapter applies the editor rules, reads through the library, and discards stale loads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spice-includes-'));
  await mkdir(join(root, 'docs', 'models'), { recursive: true });
  const model = join(root, 'docs', 'models', 'q.lib');
  await writeFile(model, '.model Q PNP\n');
  await writeFile(join(root, 'outside.lib'), '.model Q NPN\n');
  let reads = 0, refreshes = 0;
  const counted: typeof library = {
    ...library,
    nodeFileReader: (options) => {
      const reader = library.nodeFileReader(options);
      return { read: (key, limits) => { reads++; return reader.read(key, limits); } } satisfies FileReader;
    }
  };
  const callbacks = new Map<string, (arg: unknown) => void>();
  const event = (name: string) => (cb: (arg: unknown) => void) => { callbacks.set(name, cb); return { dispose() {} }; };
  const folder = join(root, 'docs');
  const workspace = {
    isTrusted: false, getWorkspaceFolder: () => ({ uri: new Uri(folder) }),
    createFileSystemWatcher: () => ({ onDidChange: event('change'), onDidCreate: event('create'), onDidDelete: event('delete'), dispose() {} }),
    onDidRenameFiles: event('rename'), onDidSaveTextDocument: event('save'), onDidCloseTextDocument: event('close'),
    onDidChangeWorkspaceFolders: event('folders'), onDidGrantWorkspaceTrust: event('trust')
  };
  const module: { exports: { IncludeFiles?: new (library: unknown) => Files } } = { exports: {} };
  const nativeRequire = createRequire(import.meta.url);
  runInNewContext(compiled, {
    exports: module.exports, module, setTimeout, clearTimeout, console, Buffer,
    require: (id: string) => id === 'vscode'
      ? { workspace, Uri, commands: { executeCommand: async () => { refreshes++; } } }
      : nativeRequire(id)
  });
  const files = new module.exports.IncludeFiles!(counted);
  const env = { currentDocument: new Uri(join(folder, 'demo.md')) };
  const source = '.include models/q.lib\nQ1 c b e Q\nR1 c 0 1k';
  try {
    // Restricted Mode: netlists without includes prepare, includes are refused without reading.
    assert.equal(unread(await settle(files, 'R1 a 0 1k', env)), undefined);
    assert.equal(unread(await settle(files, source, env)), 'files are read only in a trusted workspace');
    assert.equal(reads, 0);

    workspace.isTrusted = true;
    callbacks.get('trust')!(undefined);
    files.clear();
    assert.equal(unread(await settle(files, source, { currentDocument: new Uri('/demo.md', 'vscode-remote') })), 'files are read only from a local folder');
    assert.equal(unread(await settle(files, source, undefined)), 'save the Markdown document in a workspace folder first');
    assert.equal(unread(await settle(files, '.include ../outside.lib\nR1 a 0 1', env)), 'it is outside the Markdown document’s workspace folder');
    assert.equal(reads, 1);

    // The dialect is part of the key, and reaches `prepare`.
    const hspice = await settle(files, source, env, 'HSPICE') as Prepared;
    assert.equal(hspice.dialect, 'hspice');
    assert.equal(unread(await settle(files, source, env, 'nope')), '"nope" is not a SPICE dialect; use one of ngspice, ltspice, pspice, hspice, xyce, spectre');
    const readsBefore = reads;

    // Invalidate while the first load is still pending: its result must not repopulate the cache.
    assert.equal(files.prepare(source, env, 'ngspice'), undefined);
    while (reads === readsBefore) await new Promise((resolve) => setTimeout(resolve, 1));
    callbacks.get('change')!(new Uri(model));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const prepared = await settle(files, source, env) as Prepared;
    assert.equal(unread(prepared), undefined);
    assert.deepEqual(prepared.files.map((file) => file.key), ['models/q.lib']);
    assert.equal(reads, readsBefore + 2);
    assert.equal(files.prepare(source, env, 'ngspice'), prepared, 'cached');

    // A missing file is watched too, so recreating it prepares the fence again.
    await rm(model);
    callbacks.get('delete')!(new Uri(model));
    assert.equal(unread(await settle(files, source, env)), 'file not found');
    await writeFile(model, '.model Q NPN\n');
    callbacks.get('create')!(new Uri(join(folder, 'models')));
    assert.equal(unread(await settle(files, source, env)), undefined, 'a folder event covers the files under it');

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert(refreshes > 0);
    const count = refreshes;
    files.dispose();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(refreshes, count);
  } finally {
    files.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
