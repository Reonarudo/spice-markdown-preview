/**
 * Load the vendored Xyce module into the parser registry, for every test that reads a netlist in
 * the `xyce` dialect through `parseNetlist` or `includeReferences` (ADR 0008: the reader is
 * synchronous over a preloaded registry, so a test file awaits this in a `before` hook).
 */
import { createRequire } from 'node:module';
import { loadParser, type ParserFactory } from '../../src/parser/registry';

const require = createRequire(import.meta.url);

export async function loadXyce(): Promise<void> {
  await loadParser('xyce', require('../../vendor/parsers/xyce.cjs') as ParserFactory);
}
