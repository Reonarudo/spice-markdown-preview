/**
 * Load the vendored ngspice module into the parser registry, for every test that reads a netlist
 * through `parseNetlist` or `includeReferences` (ADR 0008: the reader is synchronous over a
 * preloaded registry, so a test file awaits this in a `before` hook).
 */
import { createRequire } from 'node:module';
import { loadParser, type ParserFactory } from '../../src/parser/registry';

const require = createRequire(import.meta.url);

export async function loadNgspice(): Promise<void> {
  await loadParser('ngspice', require('../../vendor/parsers/ngspice.cjs') as ParserFactory);
}
