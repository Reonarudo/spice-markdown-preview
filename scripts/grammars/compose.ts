/**
 * The grammar composer (ADR 0009): a base `.l`/`.y` declares named sections; a dialect's overlay
 * replaces, keeps or removes them whole; the catalogue fills the `generated:*` sections. Every
 * section in the composed file starts with a banner naming its source, so flex and Bison line
 * numbers read directly against `grammar/generated/<dialect>.l|.y`.
 *
 * `compose` is pure. Reading the tree and writing the files is the CLI at the bottom.
 */

import type { Dialect } from '../../src/catalogue/dialects';
import type { ElementType } from '../../src/catalogue/types';

/** One grammar pair as read from disk; `name` is the directory the banners cite. */
export interface GrammarSource {
  name: string;
  l: string;
  y?: string;
}

/** The text of every `generated:*` section a dialect has, by section name. */
export type GeneratedSections = Readonly<Record<string, string>>;

export interface Composed {
  l: string;
  y: string;
}

export class ComposeError extends Error {
  override name = 'ComposeError';
}

const SECTION_START = /^\/\/@ section (\S+)\s*$/;
const SECTION_END = /^\/\/@ end\s*$/;

interface Section {
  name: string;
  lines: string[];
}

/** A grammar file cut at its markers: text between sections stays as a `null`-named run. */
type Piece = { section: Section } | { text: string[] };

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function parseSections(text: string, file: string): Piece[] {
  const pieces: Piece[] = [];
  let outside: string[] = [];
  let open: Section | undefined;
  const seen = new Set<string>();
  for (const [index, line] of splitLines(text).entries()) {
    const where = `${file}:${index + 1}`;
    const start = SECTION_START.exec(line);
    if (start) {
      if (open) throw new ComposeError(`${where}: section ${start[1]} opens inside section ${open.name}`);
      if (seen.has(start[1]!)) throw new ComposeError(`${where}: section ${start[1]} is declared twice`);
      seen.add(start[1]!);
      if (outside.length) pieces.push({ text: outside });
      outside = [];
      open = { name: start[1]!, lines: [] };
    } else if (SECTION_END.test(line)) {
      if (!open) throw new ComposeError(`${where}: //@ end without a section`);
      pieces.push({ section: open });
      open = undefined;
    } else if (open) {
      open.lines.push(line);
    } else {
      outside.push(line);
    }
  }
  if (open) throw new ComposeError(`${file}: section ${open.name} is never ended`);
  if (outside.length) pieces.push({ text: outside });
  return pieces;
}

function banner(text: string): string {
  return `  /* ${text} */`;
}

/** Outside its sections an overlay may only carry blank lines and C comments. */
function isCommentary(lines: string[]): boolean {
  let inComment = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inComment) {
      if (line.includes('*/')) inComment = false;
      continue;
    }
    if (line === '') continue;
    if (line.startsWith('/*')) {
      inComment = !line.includes('*/');
      continue;
    }
    return false;
  }
  return true;
}

/** The overlay's sections by name; everything outside them must be commentary. */
function overlaySections(overlay: GrammarSource, kind: 'l' | 'y', file: string): Map<string, Section> {
  const text = overlay[kind];
  const sections = new Map<string, Section>();
  if (text === undefined) return sections;
  for (const piece of parseSections(text, file)) {
    if ('text' in piece) {
      if (!isCommentary(piece.text)) throw new ComposeError(`${file}: text outside a section: ${piece.text.find((line) => line.trim() !== '')!.trim()}`);
      continue;
    }
    sections.set(piece.section.name, piece.section);
  }
  return sections;
}

function isEmpty(section: Section): boolean {
  return section.lines.every((line) => line.trim() === '');
}

function composeFile(base: GrammarSource, overlay: GrammarSource | undefined, generated: GeneratedSections, kind: 'l' | 'y'): string {
  const fileName = kind === 'l' ? 'scanner.l' : 'parser.y';
  const baseFile = `${base.name}/${fileName}`;
  const overlayFile = overlay ? `${overlay.name}/${fileName}` : undefined;
  const replacements = overlay ? overlaySections(overlay, kind, overlayFile!) : new Map<string, Section>();
  const out: string[] = [];
  for (const piece of parseSections(base[kind]!, baseFile)) {
    if ('text' in piece) {
      out.push(...piece.text);
      continue;
    }
    const { name } = piece.section;
    if (name.startsWith('generated:')) {
      if (replacements.has(name)) throw new ComposeError(`${overlayFile}: section ${name} is generated from the catalogue and may not appear in an overlay`);
      if (!isEmpty(piece.section)) throw new ComposeError(`${baseFile}: generated section ${name} must be empty in the base`);
      const text = generated[name];
      if (text === undefined) throw new ComposeError(`${baseFile}: no generator for section ${name}`);
      out.push(...splitLines(text));
      continue;
    }
    const replacement = replacements.get(name);
    if (replacement === undefined) {
      out.push(banner(`from ${baseFile}: ${name}`), ...piece.section.lines);
    } else if (isEmpty(replacement)) {
      out.push(banner(`section ${name} removed by ${overlayFile}`));
    } else {
      out.push(banner(`from ${overlayFile}: ${name}`), ...replacement.lines);
    }
    replacements.delete(name);
  }
  for (const name of replacements.keys()) throw new ComposeError(`${overlayFile}: section ${name} is not declared by ${baseFile}`);
  return out.join('\n') + '\n';
}

export function compose(base: GrammarSource, overlay: GrammarSource | undefined, generated: GeneratedSections): Composed {
  if (base.y === undefined) throw new ComposeError(`${base.name} has no parser.y`);
  return { l: composeFile(base, overlay, generated, 'l'), y: composeFile(base, overlay, generated, 'y') };
}

// --- Generated sections -------------------------------------------------------------------------

const DIALECTS_FILE = 'src/catalogue/dialects.ts';

function catalogueFile(id: string): string {
  return `src/catalogue/${id}.ts`;
}

/** A flex character class for the letters, with anything that is not a letter or digit escaped. */
function characterClass(letters: readonly string[]): string {
  return `[${[...letters].sort().map((letter) => (/^[A-Za-z0-9]$/.test(letter) ? letter : `\\${letter}`)).join('')}]`;
}

/** Sorted text → the files that spell it, for the banner above each generated rule. */
type Claims = Map<string, Set<string>>;

function claim(claims: Claims, text: string, file: string): void {
  const files = claims.get(text) ?? new Set<string>();
  files.add(file);
  claims.set(text, files);
}

function rules(claims: Claims, pattern: (text: string) => string, action: string): string[] {
  const lines: string[] = [];
  for (const text of [...claims.keys()].sort()) {
    lines.push(banner(`generated from ${[...claims.get(text)!].sort().join(', ')}`), `${pattern(text)}  { ${action}; }`);
  }
  return lines;
}

/**
 * Refuse a selector value two entries both claim on one letter of one dialect. Form keywords are
 * not claims — `POLY` is shared by every dependent source on purpose — so they are gathered
 * without this check.
 */
function claimOnce(owners: Map<string, string>, key: string, file: string, dialect: Dialect, describe: string): void {
  const other = owners.get(key);
  if (other !== undefined && other !== file) {
    throw new ComposeError(`${dialect.id}: ${describe} is claimed by both ${[other, file].sort().join(' and ')}`);
  }
  owners.set(key, file);
}

/** The `generated:*` sections of one dialect, from its table entry and a catalogue. */
export function generatedSections(dialect: Dialect, catalogue: Readonly<Record<string, ElementType>>): GeneratedSections {
  const keywords: Claims = new Map();
  const suffixes: Claims = new Map();
  const masters: Claims = new Map();
  const selectorOwners = new Map<string, string>();
  const masterOwners = new Map<string, string>();

  for (const id of Object.keys(catalogue).sort()) {
    const type = catalogue[id]!;
    const file = catalogueFile(id);
    const spellings = type.spellings.filter((spelling) => spelling.dialect === dialect.id);
    if (spellings.length === 0) continue;
    for (const spelling of spellings) {
      if (spelling.dialect === 'spectre') {
        if (spelling.master === '*') continue;
        claimOnce(masterOwners, spelling.master, file, dialect, `master ${spelling.master}`);
        claim(masters, spelling.master, file);
        continue;
      }
      const select = spelling.select;
      if (select?.by === 'keyword') {
        for (const keyword of select.keywords) {
          claimOnce(selectorOwners, `${spelling.letter} ${keyword}`, file, dialect, `${spelling.letter} ${keyword}`);
          claim(keywords, keyword, file);
        }
      } else if (select?.by === 'suffix') {
        for (const suffix of select.suffixes) {
          claimOnce(selectorOwners, `${spelling.letter} ${suffix}`, file, dialect, `${spelling.letter} ${suffix}`);
          claim(suffixes, `${spelling.letter}${suffix}`, file);
        }
      }
    }
    for (const form of type.forms) {
      if (form.dialects !== undefined && !form.dialects.includes(dialect.id)) continue;
      if (form.match !== undefined && 'keyword' in form.match) {
        for (const keyword of form.match.keyword) claim(keywords, keyword, file);
      }
    }
  }

  const options = dialect.caseSensitive
    ? [banner(`generated from ${DIALECTS_FILE}: ${dialect.id} is case-sensitive`)]
    : [banner(`generated from ${DIALECTS_FILE}: ${dialect.id} is case-insensitive`), '%option caseless'];
  const letters = dialect.letters.length === 0
    ? [banner(`generated from ${DIALECTS_FILE}: ${dialect.id} has no element letters`)]
    : [banner(`generated from ${DIALECTS_FILE}: ${dialect.id} letters`), `ELEMENT_LETTER  ${characterClass(dialect.letters)}`];
  const keywordRules = [
    ...rules(keywords, (text) => `"${text}"{GROUP}?`, 'TOKEN(KEYWORD)'),
    // A suffixed head opens the card like any head: the name that follows is read as a word in
    // INITIAL, not as a head in LINESTART, where a name starting with an element letter (`mr1`)
    // would be an element head and fail the parser.
    ...rules(suffixes, (text) => `<LINESTART>"${text}"`, 'HEAD_IN(SUFFIX_HEAD, INITIAL)')
  ];
  const masterRules = rules(masters, (text) => `"${text}"`, 'TOKEN(MASTER)');

  const section = (lines: string[]): string => lines.join('\n') + '\n';
  return {
    'generated:options': section(options),
    'generated:letters': section(letters),
    'generated:keywords': section(keywordRules.length ? keywordRules : [banner(`generated from the catalogue: ${dialect.id} has no keywords`)]),
    'generated:masters': section(masterRules.length ? masterRules : [banner(`generated from the catalogue: ${dialect.id} has no masters`)])
  };
}

// --- The tree -----------------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATALOGUE } from '../../src/catalogue/index';
import { DIALECTS } from '../../src/catalogue/dialects';

/** A dialect whose inputs are not written yet is skipped, not failed: the map builds the overlays one ticket at a time. */
export type TreeResult = Composed | { skipped: string };

function readGrammar(root: string, name: string, requireY: boolean): GrammarSource | undefined {
  const l = join(root, name, 'scanner.l');
  const y = join(root, name, 'parser.y');
  if (!existsSync(l)) return undefined;
  if (requireY && !existsSync(y)) return undefined;
  const source: GrammarSource = { name, l: readFileSync(l, 'utf8') };
  if (existsSync(y)) source.y = readFileSync(y, 'utf8');
  return source;
}

function header(dialect: string, sources: string[]): string {
  return `/* ${dialect}: composed by scripts/grammars/compose.ts from ${sources.join(' and ')}; do not edit. */\n`;
}

/**
 * Compose every dialect in the table from `root`'s grammar tree. The generated sections are built
 * for every dialect first, so a catalogue conflict is refused even for a dialect with no grammar yet.
 */
export function composeTree(root: string): Map<string, TreeResult> {
  const generated = new Map(Object.values(DIALECTS).map((dialect) => [dialect.id, generatedSections(dialect, CATALOGUE)] as const));
  const results = new Map<string, TreeResult>();
  for (const dialect of Object.values(DIALECTS)) {
    const baseName = `grammar/${dialect.base}`;
    const base = readGrammar(root, baseName, true);
    if (base === undefined) {
      results.set(dialect.id, { skipped: `no base grammar at ${baseName}/` });
      continue;
    }
    let overlay: GrammarSource | undefined;
    const sources = [baseName];
    if (dialect.base === 'spice') {
      const overlayName = `grammar/dialects/${dialect.id}`;
      overlay = readGrammar(root, overlayName, false);
      if (overlay === undefined) {
        results.set(dialect.id, { skipped: `no overlay at ${overlayName}/scanner.l` });
        continue;
      }
      sources.push(overlayName);
    }
    const composed = compose(base, overlay, generated.get(dialect.id)!);
    const top = header(dialect.id, sources);
    results.set(dialect.id, { l: top + composed.l, y: top + composed.y });
  }
  return results;
}

function main(): void {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const out = join(root, 'grammar', 'generated');
  mkdirSync(out, { recursive: true });
  for (const [dialect, result] of composeTree(root)) {
    if ('skipped' in result) {
      console.log(`skipped ${dialect}: ${result.skipped}`);
      continue;
    }
    for (const kind of ['l', 'y'] as const) {
      const file = join(out, `${dialect}.${kind}`);
      const stale = !existsSync(file) || readFileSync(file, 'utf8') !== result[kind];
      if (stale) writeFileSync(file, result[kind]);
      console.log(`${stale ? 'wrote' : 'unchanged'} grammar/generated/${dialect}.${kind}`);
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
