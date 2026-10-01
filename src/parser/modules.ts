/**
 * Where the worker finds a dialect's generated parser: `<directory>/<dialect>.cjs`, the modules
 * `scripts/grammars.sh` vendors (ADR 0008). Each is `require`d and handed to the registry the
 * first time a fence in its dialect arrives, so a dialect that is never used is never loaded.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DialectId } from '../catalogue/types';
import { DIALECTS } from '../catalogue/dialects';
import { loadParser, type ParserFactory } from './registry';

/**
 * A loader for the modules in `directory` — `dist/../vendor/parsers` in the packaged extension.
 * The returned function resolves once the dialect parses synchronously through the registry, and
 * rejects — never throws — with one sentence naming the dialect and why. Both outcomes are kept,
 * so every fence after the first costs a lookup, and a module that would not load is not asked
 * again: it will not appear while the process runs.
 */
export function parserLoader(directory: string): (dialect: DialectId) => Promise<void> {
  const require = createRequire(join(directory, 'index.cjs'));
  const outcomes = new Map<DialectId, Promise<void>>();
  return (dialect) => {
    let outcome = outcomes.get(dialect);
    if (!outcome) {
      outcome = load(dialect).catch((error: unknown) => {
        throw new Error(`The ${dialect} parser could not be loaded: ${reason(error)}`);
      });
      outcomes.set(dialect, outcome);
    }
    return outcome;
  };

  async function load(dialect: DialectId): Promise<void> {
    // The dialect names a file: only a known name may be turned into a path.
    if (!Object.hasOwn(DIALECTS, dialect)) throw new Error('not a dialect');
    await loadParser(dialect, require(join(directory, `${dialect}.cjs`)) as ParserFactory);
  }
}

/** The first line of the cause: Node's "Cannot find module" carries a require stack nobody needs. */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0]!.slice(0, 200);
}
