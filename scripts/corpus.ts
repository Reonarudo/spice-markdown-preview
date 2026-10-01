/**
 * Parse a corpus of netlists with one vendored dialect module and report what each file became.
 * CI runs this over decks that cannot be committed — Xyce_Regression's `Netlists/XDM/PSPICE`
 * states no licence (Redmine #1190) — so a generated parser is still checked against real text.
 *
 *   node --import tsx scripts/corpus.ts --dialect pspice --ext .pspice,.net,.lib --title .pspice <dir>…
 *
 * `--ext` picks the files by extension; `--title` names the extensions whose first line is a
 * deck's title, dropped before parsing (a fence has none, ADR 0006). Every file is parsed by the
 * module (ADR 0008) and then read end to end by `parseNetlist`, with no included files. A
 * structural error from the module fails the run; a reader error is listed for information.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DialectId } from '../src/catalogue/types';
import { parseNetlist } from '../src/netlist';
import { loadParser, parse, type ParserFactory } from '../src/parser/registry';

interface Options {
  dialect: DialectId;
  extensions: string[];
  titled: string[];
  roots: string[];
}

function options(argv: string[]): Options {
  const found: Options = { dialect: 'ngspice', extensions: ['.cir'], titled: [], roots: [] };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${argument} needs a value`);
      return next;
    };
    if (argument === '--dialect') found.dialect = value() as DialectId;
    else if (argument === '--ext') found.extensions = value().split(',');
    else if (argument === '--title') found.titled = value().split(',');
    else found.roots.push(argument);
  }
  if (found.roots.length === 0) throw new Error('name at least one directory');
  return found;
}

function files(root: string, extensions: string[]): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return files(path, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  }).sort();
}

async function main(): Promise<void> {
  const { dialect, extensions, titled, roots } = options(process.argv.slice(2));
  const require = createRequire(import.meta.url);
  const vendored = fileURLToPath(new URL(`../vendor/parsers/${dialect}.cjs`, import.meta.url));
  await loadParser(dialect, require(vendored) as ParserFactory);

  let structural = 0;
  let total = 0;
  for (const root of roots) {
    for (const path of files(root, extensions)) {
      total++;
      const shown = relative(process.cwd(), path);
      let text = readFileSync(path, 'utf8');
      if (titled.some((extension) => path.endsWith(extension))) text = text.slice(text.indexOf('\n') + 1);
      const output = parse(dialect, text);
      if (output.error) {
        structural++;
        const { line, column, found, expected } = output.error;
        console.log(`STRUCTURAL ${shown}:${line}:${column + 1}: found ${found.class} ${JSON.stringify(found.text)}, expected ${expected.join(', ')}`);
        continue;
      }
      const result = parseNetlist(text, undefined, dialect);
      if (result.ok) {
        console.log(`ok         ${shown}: ${output.cards.length} cards, ${result.netlist.parts.length} parts, ${result.netlist.notes.length} notes`);
      } else {
        console.log(`reader     ${shown}:${result.line}:${result.column + 1}: ${result.message}`);
      }
    }
  }
  console.log(`${total} files, ${structural} with a structural error`);
  if (total === 0 || structural > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
