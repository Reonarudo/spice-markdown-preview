/**
 * Paths named by `.include` and `.lib`, as the netlist reader and the file loader both see them.
 *
 * Every included file is identified by a key: its path relative to the Markdown document's folder,
 * with `/` separators and no `.` segments, e.g. `models/bjt.lib` or `../shared/opamp.lib`. The
 * fence itself is the empty key. Whether a key stays inside the workspace is for the loader to
 * decide; this module only refuses what can never be a relative path.
 */
import { posix } from 'node:path';

export class IncludePathError extends Error {}

/**
 * The path as written, without quotes and with `\` read as `/`. Throws for anything that is not a
 * plain relative path: absolute paths, home directories, drive letters, URLs, control characters.
 */
export function normaliseIncludePath(raw: string): string {
  let path = raw;
  if (path.length >= 2 && (path[0] === '"' || path[0] === "'") && path.at(-1) === path[0]) {
    path = path.slice(1, -1);
  }
  path = path.replace(/\\/g, '/');
  if (!path) throw new IncludePathError('The path is empty.');
  if (/[\x00-\x1f]/.test(path)) throw new IncludePathError('The path contains control characters.');
  if (path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:/.test(path) || /^[A-Za-z][\w+.-]*:\/\//.test(path)) {
    throw new IncludePathError('Only paths relative to the Markdown document are read.');
  }
  const normal = posix.normalize(path);
  if (normal === '.' || normal.endsWith('/')) throw new IncludePathError('The path names a folder, not a file.');
  return normal;
}

/** The key of a file named `raw` from within the file keyed `from` (`''` for the fence). */
export function resolveInclude(from: string, raw: string): string {
  const path = normaliseIncludePath(raw);
  return posix.normalize(posix.join(posix.dirname(from || '.'), path));
}
