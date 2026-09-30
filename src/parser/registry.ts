/**
 * The loaded parsers, one per dialect (ADR 0008): a module is awaited once, then parses
 * synchronously for the rest of the process. `parseNetlist` and `includeReferences` stay
 * synchronous by reading from here, so whoever calls them first — the worker for a dialect's
 * first fence, a test's `before` hook — must have awaited `loadParser` for that dialect.
 *
 * Locating a module is the caller's job: `vendor/parsers/<dialect>.cjs` is only a stable relative
 * path from the directory that sits beside `vendor/` (`dist/` in the packaged extension, `test/`
 * here), so the caller `require`s it and hands over the factory.
 */
import type { DialectId } from '../catalogue/types';
import { CONTRACT, type ParserOutput } from './contract';

/** The surface of an Emscripten 6 module built by `scripts/grammars.sh`: the factory returns a promise. */
export interface ParserModule {
  _netlist_parse(pointer: number, length: number): number;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  lengthBytesUTF8(text: string): number;
  stringToUTF8(text: string, pointer: number, bytes: number): void;
  UTF8ToString(pointer: number): string;
}

export type ParserFactory = () => Promise<ParserModule>;

const loaded = new Map<DialectId, ParserModule>();

/**
 * Await a dialect's module once and keep it. The module's `factory` is what `require`ing
 * `vendor/parsers/<dialect>.cjs` returns.
 */
export async function loadParser(dialect: DialectId, factory: ParserFactory): Promise<void> {
  if (loaded.has(dialect)) return;
  const module = await factory();
  // A stale module fails here, once, rather than at the first netlist that trips over the difference.
  const { contract } = run(module, '');
  if (contract !== CONTRACT) {
    throw new Error(`the ${dialect} parser returns contract ${contract}; this build reads contract ${CONTRACT} — run npm run grammars`);
  }
  loaded.set(dialect, module);
}

/** Parse one file's text with the dialect's module. Throws when the dialect was never loaded. */
export function parse(dialect: DialectId, text: string): ParserOutput {
  const module = loaded.get(dialect);
  if (!module) throw new Error(`the ${dialect} parser is not loaded`);
  return run(module, text);
}

function run(module: ParserModule, text: string): ParserOutput {
  const bytes = module.lengthBytesUTF8(text);
  const pointer = module._malloc(bytes + 1);
  try {
    module.stringToUTF8(text, pointer, bytes + 1);
    return JSON.parse(module.UTF8ToString(module._netlist_parse(pointer, bytes))) as ParserOutput;
  } finally {
    module._free(pointer);
  }
}
