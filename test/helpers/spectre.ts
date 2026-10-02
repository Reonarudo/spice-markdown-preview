/**
 * Load the vendored Spectre modules — native Spectre and its SPICE mode, since a Spectre netlist
 * may switch between them — into the parser registry, for every test that reads a netlist in the
 * `spectre` dialect through `parseNetlist` or `includeReferences` (ADR 0008: the reader is
 * synchronous over a preloaded registry, so a test file awaits this in a `before` hook).
 */
import { createRequire } from 'node:module';
import { loadParser, type ParserFactory } from '../../src/parser/registry';
import { modulesFor } from '../../src/parser/regions';

const require = createRequire(import.meta.url);

export async function loadSpectre(): Promise<void> {
  for (const module of modulesFor('spectre')) {
    await loadParser(module, require(`../../vendor/parsers/${module}.cjs`) as ParserFactory);
  }
}
