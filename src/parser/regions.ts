/**
 * Language regions of a Spectre netlist (ADR 0009, *Driver and region splitting*). Spectre reads
 * one file in two languages — its own, and SPICE mode — switching at every `simulator lang=`
 * statement (Spectre User Guide 5.1 p.53), so the text is cut into regions before parsing and
 * each region goes to the module of its language: `spectre` or `spectre-spice`. The switch is not
 * scoped by `subckt` or `if`, so block matching stays with the reader, over the concatenated cards.
 *
 * A region's text keeps its place in the file: every line before it is blank, so the cards come
 * back with their real line numbers and no continuation can cross the boundary. The `simulator`
 * line itself belongs to no region.
 */
import type { DialectId } from '../catalogue/types';

/** The two languages a Spectre netlist is written in; `spectre-spice` is internal (dialects.ts). */
export type SpectreLanguage = 'spectre' | 'spectre-spice';

/** The parser modules a netlist in `dialect` may need: a Spectre netlist may switch, so it needs both. */
export function modulesFor(dialect: DialectId): DialectId[] {
  return dialect === 'spectre' ? ['spectre', 'spectre-spice'] : [dialect];
}

/**
 * The language a file starts in (UG p.50–51; Reference 19.1 p.493): an included file starts in
 * SPICE mode unless its name ends in `.scs`. The fence (`''`) starts in Spectre — the decision of
 * the naming ticket: a fence is read as an included `.scs` file would be, with no title line.
 */
export function startLanguage(file: string): SpectreLanguage {
  return file === '' || /\.scs$/i.test(file) ? 'spectre' : 'spectre-spice';
}

export interface Region {
  language: SpectreLanguage;
  /** The region's lines, preceded by one blank line for every line of the file before them. */
  text: string;
  /** 1-based line of the region's first line. */
  start: number;
  /** The region's lines, as written. */
  lines: string[];
}

/** `simulator lang=spice|spectre [insensitive=yes]`; SPICE mode folds case, so the match ignores it. */
const SWITCH = /^\s*simulator(?:\s+([^\n]*))?$/i;
const LANGUAGE = /\blang\s*=\s*(spice|spectre)\b/i;

/**
 * Cut `text` into regions at its `simulator` lines. A `simulator` line that names no language
 * (`simulator lang=spectre insensitive=yes` names one; a bare `simulator` does not) keeps the
 * language and is still dropped. Regions holding only blank lines are left out.
 */
export function splitRegions(text: string, start: SpectreLanguage): Region[] {
  const lines = text.split('\n');
  const regions: Region[] = [];
  let language = start;
  let from = 0;
  const close = (to: number): void => {
    const slice = lines.slice(from, to);
    if (slice.some((line) => line.trim() !== '')) {
      regions.push({ language, start: from + 1, lines: slice, text: '\n'.repeat(from) + slice.join('\n') + (to < lines.length ? '\n' : '') });
    }
  };
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, '');
    const match = SWITCH.exec(line);
    if (!match) continue;
    close(index);
    const named = LANGUAGE.exec(match[1] ?? '')?.[1]?.toLowerCase();
    if (named === 'spice') language = 'spectre-spice';
    else if (named === 'spectre') language = 'spectre';
    from = index + 1;
  }
  close(lines.length);
  return regions;
}
