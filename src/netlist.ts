/**
 * A SPICE netlist reader for drawing, not simulating: it keeps every element's kind, pins and value
 * and skips everything that only matters to a simulator.
 *
 * The dialect's generated parser (ADR 0008) splits each file into cards and tokens; this module
 * owns everything else — includes, nesting, models, the element catalogue's forms (ADR 0007),
 * notes and every message. Total by construction: every input yields either a netlist or one
 * error naming a line and column. Nothing is read from disk here: `.include` and `.lib` are
 * expanded from the files the caller supplies, and noted and skipped when it supplies none.
 */
import { IncludePathError, resolveInclude } from './include-paths';
import { CATALOGUE, elementTypeForLetter, type ElementTypeId, type SpellingHints } from './catalogue/index';
import { DIALECTS } from './catalogue/dialects';
import type { CountSource, DialectId, ElementType, Form, PinRule, Terminal, Terminals } from './catalogue/types';
import { parse } from './parser/registry';
import type { Card as ParsedCard, ParseError as ParserError, Token as ParsedToken } from './parser/contract';

export type { ElementTypeId };

export type Kind =
  | 'resistor' | 'capacitor' | 'inductor' | 'diode'
  | 'vsource' | 'isource' | 'npn' | 'pnp' | 'nmos' | 'pmos'
  /** Anything drawn as a labelled box: subcircuit instances, dependent sources, switches, … */
  | 'block';

export interface Pin {
  /** The symbol's pin id, e.g. `A`, `+`, `C`, or the subcircuit's port name. */
  name: string;
  /** Normalised node name: lower case, and `0` for every spelling of ground. */
  node: string;
}

export interface Part {
  /** The element name as written, e.g. `R1`. */
  ref: string;
  /** The element type from the catalogue, e.g. `vcvs`; `kind` is what is drawn for it. */
  type: ElementTypeId;
  kind: Kind;
  pins: Pin[];
  /** Everything after the nodes, e.g. `10k`, `SIN(0 1 1k)` or a model name. May be empty. */
  value: string;
  /** For a block: what it is, e.g. the subcircuit name or `VCVS`. */
  title?: string;
  /** 1-based source line the element starts on. */
  line: number;
  /** The included file the element comes from; absent for the fence itself. */
  file?: string;
}

export interface Netlist {
  parts: Part[];
  /** Things skipped or assumed, for the output channel. Never shown in the preview. */
  notes: string[];
}

export type ParseResult =
  | { ok: true; netlist: Netlist }
  | { ok: false; message: string; line: number; column: number };

/**
 * The files a netlist may include, keyed as in `include-paths.ts`. An entry that could not be read
 * carries why; it is an error only if the netlist actually includes it.
 */
export interface IncludeSet {
  files: Record<string, string | { error: string }>;
  /** Set when no file could be read at all, saying why; every include is then noted and skipped. */
  unavailable?: string;
}

/** Includes nested deeper than this are refused, as a cycle the key check missed would be. */
export const MAX_INCLUDE_DEPTH = 8;

/** The node every spelling of ground is normalised to. */
export const GROUND = '0';

/** More parts than this cannot be laid out legibly, and would only run into the time limit. */
export const MAX_PARTS = 400;

interface Position {
  line: number;
  /** 0-based column in the source line. */
  column: number;
  /** The included file, or `''` for the fence. */
  file: string;
  /** For a position in an included file: the path in the fence's `.include` that led to it. */
  anchor?: { line: number; column: number };
}

/** One card as the parser returned it, placed in its file. */
interface Card {
  parsed: ParsedCard;
  file: string;
  anchor?: Position['anchor'];
  /** The file's lines — for the one thing the cards do not say, where a parenthesised node list closes. */
  lines: string[];
}

/** What a `.model` line says that decides a drawing. */
interface Model {
  /** The type word, lower-cased: `npn`, `vdmos`. */
  type: string;
  level?: number;
  /** Bare words after the type, lower-cased: ngspice's `pchan`. */
  flags: string[];
}

class ParseError extends Error {
  constructor(message: string, readonly at: Position) {
    super(message);
  }
}

const TITLE_HINT = ' If this line is a title, start it with * to make it a comment.';

/**
 * Dialects in which a one-argument `.lib file` reads the whole file. ngspice reads a library only
 * by section (`.lib file section`), and so do HSPICE (CR p.137) and Xyce (RG §2.1.16: the call is
 * always `.LIB file entry`); LTspice and PSpice read the file (confirmed by their overlay tickets).
 */
const WHOLE_FILE_LIB: ReadonlySet<DialectId> = new Set(['ltspice', 'pspice']);

/**
 * Dialects whose one-argument `.lib file` is a library, not an include: elements at the file's top
 * level are not part of the circuit (LTspice help: "Circuit elements at global scope are ignored";
 * PSpice RG p.51: a library holds only models, subcircuits, parameters and functions), and a file
 * that is not here is noted, not an error — both simulators resolve bare names such as
 * `standard.dio` or `nom.lib` against their own library folders, which the preview cannot see.
 * The wording names the simulator.
 */
const LIBRARY_LIB: Readonly<Partial<Record<DialectId, { folder: string; dropped: string }>>> = {
  ltspice: { folder: 'LTspice reads it from its own library folder.', dropped: 'LTspice ignores them in a .lib file.' },
  pspice: { folder: 'PSpice reads it from its library path.', dropped: 'a PSpice library holds only models, subcircuits, parameters and functions.' }
};

/**
 * Dialects whose `.lib` has no sections and no `.endl` (PSpice RG p.51): a one-argument `.lib` is
 * always a whole file, never the start of a section, and a bare `.lib` names the default library,
 * `nom.lib`, which lives in the simulator's library path.
 */
const SECTIONLESS_LIB: ReadonlySet<DialectId> = new Set(['pspice']);

/**
 * Dialects whose grammar swallows everything from the first `.alter` to `.end` (HSPICE CR p.28: a
 * re-run that redefines elements by name) and the encrypted lines between `.protect` and
 * `.unprotect` (CR p.227): the reader only notes what was left out.
 */
const ALTER_AND_PROTECT: ReadonlySet<DialectId> = new Set(['hspice']);

/**
 * Dialects with HSPICE's automatic model selector (Star-Hspice 15-8): an element's model `nch`
 * picks among `.model nch.1 …`, `.model nch.2 …` by its geometry, and any of them says the type.
 */
const MODEL_SELECTOR: ReadonlySet<DialectId> = new Set(['hspice']);

/** Types whose value may not be left off; a source without one is simply a 0 V or 0 A source. */
const VALUE_REQUIRED: ReadonlySet<ElementTypeId> = new Set(['resistor', 'capacitor', 'inductor']);

/** What the note calls an optional terminal that a symbol does not draw. */
const UNDRAWN_TERMINALS: Readonly<Record<string, string>> = { S: 'substrate', tj: 'thermal', tc: 'thermal', tl: 'thermal', T: 'thermal', P: 'body contact', body: 'body' };

/**
 * Read a netlist. `includes` supplies the files `.include` and `.lib` name; without it, every
 * include is noted and skipped. `dialect` names the generated parser the netlist is read with
 * (ADR 0008); whoever calls this first must have loaded that parser into the registry.
 */
export function parseNetlist(source: string, includes?: IncludeSet, dialect: DialectId = 'ngspice'): ParseResult {
  try {
    return { ok: true, netlist: read(source, includes ?? { files: {}, unavailable: 'no files are available here' }, dialect) };
  } catch (error) {
    if (error instanceof ParseError) {
      const { at } = error;
      // An error in an included file is shown at the fence's include, naming where it really is.
      if (at.file && at.anchor) {
        return { ok: false, message: `In ${at.file}, line ${at.line}: ${error.message}`, line: at.anchor.line, column: at.anchor.column };
      }
      return { ok: false, message: error.message, line: at.line, column: at.column };
    }
    throw error;
  }
}

/**
 * The keys of every file a text includes, directly — for the loader, which follows them to load
 * the whole closure. Never throws; a malformed text simply yields what was found before the fault.
 */
export function includeReferences(text: string, from: string, dialect: DialectId = 'ngspice'): string[] {
  const keys: string[] = [];
  try {
    const { cards } = toCards(text, from, undefined, dialect);
    cards.forEach((card, index) => {
      const target = includeTarget(cards, index, dialect);
      if (!target) return;
      try {
        keys.push(resolveInclude(from, target.path.text));
      } catch {
        // A bad path is reported where the netlist reader meets it.
      }
    });
  } catch {
    // Same: the reader reports it.
  }
  return [...new Set(keys)];
}

// --- Positions and wording -------------------------------------------------------------------------

function at(card: Card, span: { line: number; column: number }): Position {
  return { line: span.line, column: span.column, file: card.file, ...(card.anchor ? { anchor: card.anchor } : {}) };
}

/** A card's head: the element name or the directive. */
function head(card: Card): Position {
  return at(card, card.parsed);
}

/** Just past a card's last token, where a missing one would go. */
function end(card: Card): Position {
  const last = card.parsed.tokens.at(-1) ?? card.parsed;
  return at(card, { line: last.line, column: last.end + 1 });
}

/** Where a card is, for notes and messages: `line 4` in the fence, `models.lib line 4` elsewhere. */
function where(card: Card): string {
  return card.file ? `${card.file} line ${card.parsed.line}` : `line ${card.parsed.line}`;
}

function capitalise(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

function uncapitalise(text: string): string {
  return text[0]!.toLowerCase() + text.slice(1);
}

/**
 * A SPICE file's first line is its title, which in a fence usually fails to parse as an element.
 * Say so where it would help.
 */
function titleHint(position: { line: number; file: string }): string {
  return position.line === 1 && position.file === '' ? TITLE_HINT : '';
}

/** The directive a card is, lower-cased with its dot, or `''` for an element. */
function directive(card: Card): string {
  return card.parsed.kind === 'directive' ? card.parsed.name : '';
}

/** The text a directive's argument was written as, without the quotes a path may carry. */
function unquote(text: string): string {
  return text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0] ? text.slice(1, -1) : text;
}

// --- Cards -----------------------------------------------------------------------------------------

/**
 * Split a file into cards with the dialect's parser. The cards before a structural error are
 * returned with it, so that `includeReferences` can stay best-effort; `read` throws it.
 */
function toCards(text: string, file: string, anchor: Position['anchor'], dialect: DialectId, notes?: string[]): { cards: Card[]; error?: ParseError } {
  const output = parse(dialect, text);
  const lines = text.split(/\r?\n/);
  const cards: Card[] = output.cards.map((parsed) => ({ parsed, file, ...(anchor ? { anchor } : {}), lines }));
  if (output.afterEnd !== undefined && notes) {
    const after = output.afterEnd;
    notes.push(`${capitalise(where(cards.at(-1)!))}: ${after} ${after === 1 ? 'line' : 'lines'} after .end ${after === 1 ? 'is' : 'are'} not read.`);
  }
  return output.error ? { cards, error: structuralError(output.error, file, anchor) } : { cards };
}

/** The parser's one error in today's wording: coded errors byte for byte, the rest generically. */
function structuralError(error: ParserError, file: string, anchor: Position['anchor']): ParseError {
  const position: Position = { line: error.line, column: error.column, file, ...(anchor ? { anchor } : {}) };
  const hint = titleHint(position);
  switch (error.code) {
    case 'orphan-continuation':
      return new ParseError('A continuation line (+) has nothing to continue.', position);
    case 'not-an-element':
      return new ParseError(`"${error.found.text}" is not an element name. Element names start with a letter, e.g. R1.${hint}`, position);
    case 'unterminated-group':
      return new ParseError(`The ${error.found.text} opened here is not closed.${hint}`, position);
    default: {
      const found = error.found.class === 'newline' ? 'end of line' : error.found.class === 'end of file' ? 'end of file' : `${error.found.class} "${error.found.text}"`;
      const expected = error.expected.length > 1 ? `${error.expected.slice(0, -1).join(', ')} or ${error.expected.at(-1)}` : error.expected[0] ?? 'something else';
      return new ParseError(`Unexpected ${found}; expected ${expected}.${hint}`, position);
    }
  }
}

// --- Includes --------------------------------------------------------------------------------------

/**
 * Whether the card at `index` includes a file, and which: any `.inc…` directive (`.include`,
 * `.inc`, `.incl`), `.lib path section`, or `.lib path` alone in a dialect that reads a whole
 * file by it. A one-argument `.lib` that an `.endl` closes defines a section instead.
 */
function includeTarget(cards: Card[], index: number, dialect: DialectId): { path: ParsedToken; section?: ParsedToken } | undefined {
  const card = cards[index]!;
  const name = directive(card);
  const [path, section] = card.parsed.tokens;
  if (name.startsWith('.inc')) return path ? { path } : undefined;
  if (name !== '.lib' || !path) return undefined;
  if (section) return { path, section };
  if (isSectionStart(cards, index, dialect)) return undefined;
  return WHOLE_FILE_LIB.has(dialect) ? { path } : undefined;
}

/**
 * Whether a one-argument `.lib` opens a section. Sections do not nest, so it does when the next
 * section marker — another one-argument `.lib`, or `.endl` — is an `.endl`. A dialect whose
 * libraries have no sections never opens one.
 */
function isSectionStart(cards: Card[], index: number, dialect: DialectId): boolean {
  if (SECTIONLESS_LIB.has(dialect) || !isOneArgumentLib(cards[index]!)) return false;
  const next = cards.slice(index + 1).find((later) => isOneArgumentLib(later) || directive(later) === '.endl');
  return next !== undefined && !isOneArgumentLib(next);
}

function isOneArgumentLib(card: Card): boolean {
  return directive(card) === '.lib' && card.parsed.tokens.length === 1;
}

/**
 * Replace every include with the cards it names, recursively, as SPICE does before reading
 * anything else. Section definitions (`.lib name` … `.endl`) are dropped unless a `.lib path name`
 * selected them.
 */
function expand(cards: Card[], from: string, includes: IncludeSet, notes: string[], stack: string[], dialect: DialectId): Card[] {
  const out: Card[] = [];
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!;
    const word = directive(card);
    if (isSectionStart(cards, index, dialect)) {
      // Only a library file selected by `.lib path name` defines sections; ngspice refuses them
      // anywhere else, and the drawing simply goes on without them.
      if (stack.length === 0 || !WHOLE_FILE_LIB.has(dialect)) {
        notes.push(`${capitalise(where(card))}: section ${card.parsed.tokens[0]!.text} is not read; a library section is read only by .lib file section.`);
      }
      while (index < cards.length && directive(cards[index]!) !== '.endl') index++;
      continue;
    }
    if (word === '.endl') continue;
    // Nothing after `.end` is read. In an included file it ends only that file, so that a model
    // library ending in `.end` does not cut off the rest of the fence.
    if (word === '.end') {
      if (from === '') out.push(card);
      break;
    }
    if (word.startsWith('.inc') || word === '.lib') {
      const target = includeTarget(cards, index, dialect);
      if (!target) {
        if (word === '.lib' && card.parsed.tokens.length === 0 && SECTIONLESS_LIB.has(dialect)) {
          // PSpice's bare `.LIB` reads nom.lib from its library path, which the preview cannot see.
          notes.push(`${capitalise(where(card))}: .lib without a file name is not read: it names nom.lib, which PSpice reads from its library path.`);
          continue;
        }
        if (isOneArgumentLib(card)) {
          const path = card.parsed.tokens[0]!;
          throw new ParseError(`.lib ${path.text} needs a section name, e.g. .lib ${path.text} tt; ${dialect} reads a library only by section.`, at(card, { line: path.line, column: path.end + 1 }));
        }
        throw new ParseError(`${word} needs a file name.`, end(card));
      }
      out.push(...include(card, target, from, includes, notes, stack, dialect));
      continue;
    }
    out.push(card);
  }
  return out;
}

function include(card: Card, target: { path: ParsedToken; section?: ParsedToken }, from: string, includes: IncludeSet, notes: string[], stack: string[], dialect: DialectId): Card[] {
  const { path, section } = target;
  const here = (token: ParsedToken) => at(card, token);
  const shown = unquote(path.text);
  // A whole-file `.lib` in a dialect where it names a library rather than an include.
  const library = section === undefined && directive(card) === '.lib' ? LIBRARY_LIB[dialect] : undefined;
  const skipLibrary = (reason: string): Card[] => {
    notes.push(`${capitalise(where(card))}: .lib ${shown} is not read: ${reason}. ${library!.folder}`);
    return [];
  };
  let key: string;
  try {
    key = resolveInclude(from, path.text);
  } catch (error) {
    if (!(error instanceof IncludePathError)) throw error;
    if (library) return skipLibrary(uncapitalise(error.message.replace(/\.$/, '')));
    throw new ParseError(`${error.message} (${path.text})`, here(path));
  }
  if (includes.unavailable !== undefined) {
    notes.push(`${capitalise(where(card))}: ${directive(card)} ${path.text} is not read: ${includes.unavailable}.`);
    return [];
  }
  // A library section may call other sections of its own file (HSPICE UG p.67), so the cycle
  // check is keyed on the file and the section, not the file alone.
  const visit = section ? `${key}#${section.text.toLowerCase()}` : key;
  if (stack.includes(visit)) throw new ParseError(`${shown} includes itself.`, here(path));
  if (stack.length >= MAX_INCLUDE_DEPTH) throw new ParseError(`Includes are nested more than ${MAX_INCLUDE_DEPTH} deep.`, here(path));
  const entry = includes.files[key];
  if (entry === undefined) {
    if (library) return skipLibrary('the file is not here');
    throw new ParseError(`${shown} could not be read.`, here(path));
  }
  if (typeof entry !== 'string') {
    if (library) return skipLibrary(entry.error.replace(/\.$/, ''));
    throw new ParseError(`${shown} could not be read: ${entry.error}`, here(path));
  }
  // Every position in the included file points back at this include in the fence.
  const anchor = card.anchor ?? { line: path.line, column: path.column };
  const found = toCards(entry, key, anchor, dialect, notes);
  if (found.error) throw found.error;
  let { cards } = found;
  if (section) {
    const name = section.text.toLowerCase();
    const start = cards.findIndex((c) => isOneArgumentLib(c) && c.parsed.tokens[0]!.text.toLowerCase() === name);
    if (start === -1) throw new ParseError(`${shown} has no section ${section.text}.`, here(section));
    const stop = cards.findIndex((c, i) => i > start && directive(c) === '.endl');
    cards = cards.slice(start + 1, stop === -1 ? undefined : stop);
  }
  const expanded = expand(cards, key, includes, notes, [...stack, visit], dialect);
  if (!library) return expanded;
  // A library's elements at its top level are not part of the circuit; its models and subcircuits are.
  const kept: Card[] = [];
  let depth = 0;
  let dropped = 0;
  for (const found of expanded) {
    const word = directive(found);
    if (word === '.subckt' || word === '.macro') depth++;
    if (depth === 0 && found.parsed.kind === 'element') {
      dropped++;
      continue;
    }
    if ((word === '.ends' || word === '.eom') && depth > 0) depth--;
    kept.push(found);
  }
  if (dropped > 0) notes.push(`${capitalise(where(card))}: ${dropped} element${dropped === 1 ? '' : 's'} at the top level of ${shown} ${dropped === 1 ? 'is' : 'are'} not part of the circuit; ${library.dropped}`);
  return kept;
}

// --- Reading ---------------------------------------------------------------------------------------

interface Context {
  dialect: DialectId;
  models: Map<string, Model>;
  subcircuits: Map<string, Ports>;
  /** HSPICE `.connect node1 node2`: the normalised second node is drawn as the first. */
  connected: Map<string, string>;
  /** Xyce `.preprocess replaceground true`: the dialect's `groundWhenReplaceGround` spellings are ground too (RG §2.1.28). */
  replaceGround: boolean;
  notes: string[];
}

/** The model an element names, by its exact name or, where the dialect has one, through the model selector. */
function findModel(context: Context, name: string): Model | undefined {
  const key = name.toLowerCase();
  const exact = context.models.get(key);
  if (exact !== undefined || !MODEL_SELECTOR.has(context.dialect)) return exact;
  for (const [candidate, model] of context.models) {
    if (candidate.startsWith(`${key}.`) && /^\d+$/.test(candidate.slice(key.length + 1))) return model;
  }
  return undefined;
}

/** The net a node belongs to after every `.connect` is applied. */
function joined(node: string, context: Context): string {
  let found = node;
  for (let hops = 0; hops < context.connected.size; hops++) {
    const next = context.connected.get(found);
    if (next === undefined) break;
    found = next;
  }
  return found;
}

function read(source: string, includes: IncludeSet, dialect: DialectId): Netlist {
  const notes: string[] = [];
  const top = toCards(source, '', undefined, dialect, notes);
  if (top.error) throw top.error;
  const cards = expand(top.cards, '', includes, notes, [], dialect);
  const context: Context = { dialect, models: new Map(), subcircuits: new Map(), connected: new Map(), replaceGround: false, notes };
  const elements: Card[] = [];

  // First pass: directives, so that a model or subcircuit defined below its use still counts.
  let inside: { kind: 'subckt' | 'control'; card: Card; depth: number } | undefined;
  // `.if` is not evaluated: the first branch is read and the others skipped, with a note.
  const conditionals: { card: Card; skipping: boolean; noted: boolean }[] = [];
  for (const card of cards) {
    const word = directive(card);
    if (inside) {
      if (inside.kind === 'subckt' && (word === '.subckt' || word === '.macro')) inside.depth++;
      if ((inside.kind === 'subckt' && (word === '.ends' || word === '.eom') && --inside.depth === 0) || (inside.kind === 'control' && word === '.endc')) {
        inside = undefined;
      }
      continue;
    }
    if (word === '.if') {
      conditionals.push({ card, skipping: false, noted: false });
      continue;
    }
    if (word === '.elseif' || word === '.else' || word === '.endif') {
      const open = conditionals.at(-1);
      if (!open) throw new ParseError(`${word} has no matching .if.`, head(card));
      if (word === '.endif') {
        conditionals.pop();
        continue;
      }
      // One note per `.if` with alternatives, and none for an `.if` inside a branch already skipped.
      if (!open.noted && !conditionals.slice(0, -1).some((outer) => outer.skipping)) {
        open.noted = true;
        notes.push(`${capitalise(where(open.card))}: .if is not evaluated; its first branch is drawn and the ${word} branches are skipped.`);
      }
      open.skipping = true;
      continue;
    }
    if (conditionals.some((open) => open.skipping)) continue;
    if (word === '.end') break;
    if (ALTER_AND_PROTECT.has(dialect) && word === '.alter') {
      notes.push(`${capitalise(where(card))}: .alter and everything after it are not read; they change the circuit for a second run.`);
      break;
    }
    if (ALTER_AND_PROTECT.has(dialect) && (word === '.protect' || word === '.prot')) {
      notes.push(`${capitalise(where(card))}: the lines between ${word} and ${word === '.prot' ? '.unprot' : '.unprotect'} are not read.`);
      continue;
    }
    if (word === '.connect' && dialect === 'hspice') {
      // `.connect node1 node2` merges the two nodes under the first name (CR p.51).
      const [first, second] = card.parsed.tokens;
      if (first && second) context.connected.set(normalise(second.text, context), normalise(first.text, context));
      continue;
    }
    if (word === '.preprocess' && DIALECTS[dialect].groundWhenReplaceGround !== undefined) {
      // Xyce `.preprocess replaceground true` makes `gnd`, `gnd!` and `ground` ground (RG §2.1.28);
      // every element is read in the second pass, so the line may stand anywhere in the file.
      const [option, value] = card.parsed.tokens;
      if (option && /^replaceground$/i.test(option.text) && value && /^(true|1)$/i.test(value.text)) context.replaceGround = true;
      continue;
    }
    if (word === '.subckt' || word === '.macro') {
      const [name, ...rest] = card.parsed.tokens;
      if (!name) throw new ParseError(`${word} needs a name.`, head(card));
      context.subcircuits.set(name.text.toLowerCase(), subcircuitPorts(rest));
      inside = { kind: 'subckt', card, depth: 1 };
      continue;
    }
    if (word === '.control') {
      inside = { kind: 'control', card, depth: 1 };
      continue;
    }
    if (word === '.model') {
      const [name, ...after] = card.parsed.tokens;
      // PSpice: `.model name AKO:reference type (…)` — the type follows the reference it is derived from.
      const ako = after[0] !== undefined && /^ako:/i.test(after[0].text) ? (after[0].text.length === 4 ? 2 : 1) : 0;
      const [type, ...rest] = after.slice(ako);
      if (name && type) {
        const level = rest.find((token) => token.class === 'pair' && token.key!.toLowerCase() === 'level');
        const parsed = level ? Number.parseInt(level.value!, 10) : Number.NaN;
        context.models.set(name.text.toLowerCase(), {
          type: type.text.toLowerCase(),
          ...(Number.isNaN(parsed) ? {} : { level: parsed }),
          flags: rest.filter((token) => token.class === 'word').map((token) => token.text.toLowerCase())
        });
      }
      continue;
    }
    if (word) continue;
    elements.push(card);
  }
  if (inside) {
    const close = inside.kind === 'subckt' ? '.ends' : '.endc';
    throw new ParseError(`${directive(inside.card)} has no matching ${close}.`, head(inside.card));
  }
  const unclosed = conditionals.at(-1);
  if (unclosed) throw new ParseError('.if has no matching .endif.', head(unclosed.card));

  const parts: Part[] = [];
  const seen = new Map<string, Card>();
  for (const card of elements) {
    const part = toPart(card, context);
    if (!part) continue;
    const key = part.ref.toLowerCase();
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      throw new ParseError(`Duplicate element ${part.ref}; it is also defined on ${where(earlier)}.`, head(card));
    }
    seen.set(key, card);
    parts.push(part);
    if (parts.length > MAX_PARTS) {
      throw new ParseError(`More than ${MAX_PARTS} elements; split the circuit into several fences.`, head(card));
    }
  }
  if (parts.length === 0) {
    throw new ParseError('No elements found. Write one element per line, e.g. R1 in out 10k.', { line: 1, column: 0, file: '' });
  }
  return { parts, notes };
}

/** A subcircuit's ports in order; the first `required` are mandatory, the rest PSpice `OPTIONAL:` pins a call may leave off from the right. */
interface Ports {
  names: string[];
  required: number;
}

/**
 * The ports of `.subckt name ports… [optional: pin=default …] [params: …] [text: …]`, written bare
 * or as one parenthesised group. PSpice's `OPTIONAL:` pins (RG p.105–108) follow the required
 * ports as `name=default` pairs, and a call may omit them from the right.
 */
function subcircuitPorts(tokens: ParsedToken[]): Ports {
  const names: string[] = [];
  let optional = false;
  let required = 0;
  for (const [index, token] of tokens.entries()) {
    if (index === 0 && token.class === 'group' && token.text.startsWith('(')) {
      names.push(...token.text.slice(1, -1).split(/[\s,]+/).filter((port) => port.length > 0));
      continue;
    }
    if (token.class === 'word' && /^optional:$/i.test(token.text)) {
      optional = true;
      required = names.length;
      continue;
    }
    if (token.class === 'word' && /^(params|text):$/i.test(token.text)) break;
    if (optional) {
      if (token.class !== 'pair') break;
      names.push(token.key!);
    } else {
      if (token.class !== 'word') break;
      names.push(token.text);
    }
  }
  return { names, required: optional ? required : names.length };
}

// --- Elements --------------------------------------------------------------------------------------

/** A terminal of a form with its repeat index applied: `nc#+` → `nc1+`. */
interface Slot {
  name: string;
  optional: boolean;
}

/** The leading tokens that may be nodes: words and keywords, up to the first pair, group, `params:` or PSpice `text:`. */
function positionalTokens(tokens: ParsedToken[]): ParsedToken[] {
  const found: ParsedToken[] = [];
  for (const token of tokens) {
    if ((token.class !== 'word' && token.class !== 'keyword') || /^(params|text):$/i.test(token.text)) break;
    found.push(token);
  }
  return found;
}

/** A keyword token's name without its arguments, upper-cased: `POLY(2)` → `POLY`, PSpice's `PINDLY (5,0,10)` → `PINDLY`. */
function keywordName(token: ParsedToken): string {
  return token.text.replace(/\s*\(.*$/, '').toUpperCase();
}

/** A keyword with its arguments as a title: `STIM( 1, 1 )` → `STIM(1,1)`. */
function keywordTitle(token: ParsedToken): string {
  return token.text.replace(/\s*\(\s*/, '(').replace(/\s*\)$/, ')').replace(/\s*,\s*/g, ',');
}

/**
 * PSpice writes a `POLY(n)` source's controlling node pairs either bare or as `(1,0)` (RG p.170):
 * the groups after the keyword that hold exactly two names are unwrapped into word tokens.
 */
function unwrapPolyPairs(tokens: ParsedToken[]): ParsedToken[] {
  const poly = tokens.findIndex((token) => token.class === 'keyword' && keywordName(token) === 'POLY');
  if (poly === -1) return tokens;
  return tokens.flatMap((token, index) => {
    if (index <= poly || token.class !== 'group' || !token.text.startsWith('(')) return [token];
    const names = token.text.slice(1, -1).split(/[\s,]+/).filter((name) => name.length > 0);
    if (names.length !== 2 || names.some((name) => /[(){}=*/]/.test(name))) return [token];
    return names.map((text) => ({ class: 'word' as const, text, line: token.line, column: token.column, end: token.end }));
  });
}

/** The numbers in a keyword's parentheses: `NANDA(2,4)` → `[2, 4]`. */
function keywordArguments(token: ParsedToken): number[] {
  const inner = /\((.*)\)/.exec(token.text)?.[1] ?? '';
  return inner.split(',').map((text) => Number.parseInt(text.trim(), 10)).filter((n) => !Number.isNaN(n));
}

function isNumeric(text: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z]*$/i.test(text);
}

function toPart(card: Card, context: Context): Part | undefined {
  const { dialect, models, notes } = context;
  const parsed = card.parsed;
  if (parsed.kind !== 'element' || parsed.letter === undefined) {
    throw new ParseError(`"${parsed.kind === 'element' ? parsed.ref : parsed.name}" is not an element name. Element names start with a letter, e.g. R1.${titleHint(head(card))}`, head(card));
  }
  const { ref, letter } = parsed;
  const tokens = dialect === 'pspice' ? unwrapPolyPairs(parsed.tokens) : parsed.tokens;
  const line = parsed.line;
  const origin = card.file ? { file: card.file } : {};
  const note = (text: string): void => { notes.push(`${capitalise(where(card))}: ${text}`); };
  const hint = titleHint(head(card));
  const leading = positionalTokens(tokens);
  const keywords = tokens.filter((token) => token.class === 'keyword');
  const pairs = tokens.filter((token) => token.class === 'pair');

  // What the line and its model say, for choosing the element type and its form.
  const model = leading.slice(1).map((token) => findModel(context, token.text)).find((found) => found !== undefined);
  const hints: SpellingHints = {
    ...(model ? { modelType: model.type } : {}),
    ...(model?.level !== undefined ? { modelLevel: model.level } : {}),
    ...(parsed.selector !== undefined ? { suffix: parsed.selector.toUpperCase() } : {}),
    keywords: keywords.map(keywordName),
    pairKeys: pairs.map((token) => token.key!.toUpperCase())
  };
  const typeId = elementTypeForLetter(dialect as Exclude<DialectId, 'spectre'>, letter, hints);
  if (typeId === undefined) {
    throw new ParseError(`Element type ${letter} (${ref}) is not supported.${hint}`, head(card));
  }
  const type = CATALOGUE[typeId];
  const chosen = chooseForm(type, dialect, keywords, pairs);
  const { form } = chosen;
  // The keyword that chose the form — or, for a type whose forms carry no keyword of their own,
  // the keyword that selected the type (`PINDLY(1,0,0)`) — sits between the nodes; it is not one
  // of them, and its arguments are the form's counts. Nor is a form-choosing keyword written
  // right before it: HSPICE's optional `VCVS` before `POLY(2)` (UG p.226). A node merely named
  // like a keyword (`noise`) anywhere else stays a node.
  const matched = chosen.matched ?? keywords.find((token) => selectsType(type, dialect, keywordName(token)));
  // A form that takes every positional token takes them from among the pairs too: HSPICE's
  // `W1 N=2 in1 in2 gnd out1 out2 gnd …` mixes nodes and parameters (UG p.154).
  const positional = form.nodesEnd === 'all-positional' ? tokens.filter((token) => leading.includes(token) || token.class === 'word' || token.class === 'keyword') : leading;
  const prefix = matched && positional[positional.indexOf(matched) - 1];
  const candidates = positional.filter((token) => token !== matched && !(token === prefix && token.class === 'keyword' && chosen.chooses.has(keywordName(token))));
  const required = requiredCount(form.terminals);
  const needs = (n: number): never => {
    const first = tokens.find((token) => !candidates.includes(token));
    throw new ParseError(`${ref} needs ${n} nodes; found ${candidates.length}.${hint}`, first ? at(card, first) : end(card));
  };

  // Where the nodes end: the form's rule, unless the parser unwrapped a parenthesised node list.
  let count: number;
  let nameToken: ParsedToken | undefined;
  if (parsed.nodesClosed) {
    count = closedNodeCount(card);
    if (form.nodesEnd === 'last-positional') nameToken = tokens[count];
    if (form.nodesEnd === 'last-positional' && nameToken === undefined) {
      throw new ParseError(`${ref} needs a ${type.tail === 'model' ? 'model' : 'subcircuit'} name.${hint}`, end(card));
    }
  } else {
    switch (form.nodesEnd) {
      case 'count': {
        count = Math.min(candidates.length, expandTerminals(form, matched, pairs, undefined).length);
        if (count < required) needs(required);
        break;
      }
      case 'model': {
        const most = expandTerminals(form, matched, pairs, undefined).length;
        const modelAt = candidates.findIndex((token, index) => index >= required && findModel(context, token.text) !== undefined);
        if (modelAt !== -1) {
          // ngspice ends the nodes at the first token naming a defined model.
          count = modelAt;
          if (count > most) {
            throw new ParseError(`${ref} connects ${count} nodes before its model, but a ${type.name} has at most ${most}.${hint}`, at(card, candidates[most]!));
          }
        } else if (candidates.length <= required) {
          count = candidates.length;
          if (count < required) needs(required);
        } else {
          // No defined model says where the nodes end: the last positional token is the model,
          // unless it is a number — an area — after the model.
          let last = candidates.length - 1;
          if (last > required && isNumeric(candidates[last]!.text)) last--;
          count = Math.min(Math.max(last, required), most);
        }
        break;
      }
      case 'last-positional':
        if (candidates.length < 1) {
          throw new ParseError(`${ref} needs a ${type.tail === 'model' ? 'model' : 'subcircuit'} name.${hint}`, end(card));
        }
        count = candidates.length - 1;
        nameToken = candidates[count];
        break;
      case 'all-positional':
        count = candidates.length;
        break;
    }
  }
  const nodeTokens = candidates.slice(0, count);
  const solves = form.counts !== undefined && Object.values(form.counts).includes('solve');
  const solved = solves ? solveCount(form, count) : undefined;
  if (solves && solved === undefined) {
    throw new ParseError(`${ref} connects ${count} nodes, which is not a whole number of ${type.name} ports.${hint}`, head(card));
  }
  const slots = expandTerminals(form, matched, pairs, solved);

  // The tail: what follows the nodes, kept as the value string; a block titled by its master
  // (a subcircuit name) leaves that out of the value, as today.
  const next = tokens.find((token) => !nodeTokens.includes(token) && token !== matched);
  // A form that took every positional token leaves its model to a pair: HSPICE `S … MNAME=`.
  if (type.tail === 'model' && nameToken === undefined && form.nodesEnd !== 'all-positional' && next?.class !== 'word') {
    throw new ParseError(`${ref} needs a model name after its nodes.${hint}`, end(card));
  }
  if (type.tail === 'value' && VALUE_REQUIRED.has(typeId) && next === undefined) {
    throw new ParseError(`${ref} needs a value after its nodes.${hint}`, end(card));
  }
  const modelName = type.tail === 'model' ? (nameToken ?? next)!.text : undefined;
  const titledByMaster = type.draw !== 'none' && 'block' in type.draw && type.draw.block.title === 'master';
  const value = tokens.filter((token) => !nodeTokens.includes(token) && !(titledByMaster && token === nameToken)).map((token) => token.text).join(' ');

  if (type.draw === 'none') {
    note(`${type.name} ${ref} (${value}) is not drawn.`);
    return undefined;
  }

  const pins = toPins(card, nodeTokens, slots, 'block' in type.draw ? type.draw.block.pins : undefined, nameToken, context, ref);

  if ('symbol' in type.draw) {
    const { symbol } = type.draw;
    let kind: string;
    if (typeof symbol === 'string') {
      kind = symbol;
    } else if (model === undefined) {
      kind = symbol.default;
      note(`model ${modelName} of ${ref} is not defined here; ${symbol.note}.`);
    } else {
      kind = symbol.byModelType?.[model.type]
        ?? model.flags.map((flag) => symbol.byModelFlag?.[flag]).find((found) => found !== undefined)
        ?? symbol.default;
    }
    // Optional terminals beyond what the symbol draws are read, so the pin count is right, and noted.
    slots.forEach((slot, index) => {
      if (index < count && slot.optional && slot.name !== 'B') note(`the ${UNDRAWN_TERMINALS[slot.name] ?? slot.name} connection of ${ref} is not drawn.`);
    });
    // The three-pin MOSFET symbols are the four-pin kinds drawn without a body.
    return { ref, type: typeId, kind: kind.replace(/3$/, '') as Kind, pins, value, line, ...origin };
  }

  const { block } = type.draw;
  let title: string;
  switch (block.title) {
    case 'model-type':
      title = model?.type ?? modelName!;
      if (model === undefined) note(`model ${modelName} of ${ref} is not defined here; its type is unknown.`);
      break;
    case 'master':
      title = nameToken!.text;
      break;
    case 'suffix':
      title = parsed.selector ?? letter;
      break;
    case 'keyword':
      title = matched ? keywordName(matched) : letter;
      break;
    case 'keyword-with-arguments':
      title = matched ? keywordTitle(matched) : letter;
      break;
    default:
      title = block.title.fixed;
  }
  if (block.polarity && model) {
    const polarity = block.polarity.byModelType[model.type];
    if (polarity !== undefined) title = `${title} (${polarity})`;
  }
  return { ref, type: typeId, kind: 'block', pins, value, title, line, ...origin };
}

/**
 * The form a line takes — one selected by a keyword or a pair on the line, else the type's default
 * (a default written for this dialect wins over the general one) — and the keyword that chose it.
 */
function chooseForm(type: ElementType, dialect: DialectId, keywords: ParsedToken[], pairs: ParsedToken[]): { form: Form; matched?: ParsedToken; chooses: ReadonlySet<string> } {
  const applicable = type.forms.filter((form) => form.dialects === undefined || form.dialects.includes(dialect));
  const chooses = new Set(applicable.flatMap((form) => (form.match && 'keyword' in form.match ? form.match.keyword : [])));
  for (const form of applicable) {
    if (!form.match) continue;
    if ('keyword' in form.match) {
      const { keyword } = form.match;
      const matched = keywords.find((token) => keyword.includes(keywordName(token)));
      if (matched) return { form, matched, chooses };
    } else {
      const { pair, values } = form.match;
      if (pairs.some((token) => pair.includes(token.key!.toUpperCase()) && (values === undefined || values.includes(token.value!.toUpperCase())))) return { form, chooses };
    }
  }
  const form = applicable.find((candidate) => candidate.match === undefined && candidate.dialects !== undefined)
    ?? applicable.find((candidate) => candidate.match === undefined)
    ?? type.forms[0]!;
  return { form, chooses };
}

function requiredCount(terminals: Terminals): number {
  let count = 0;
  for (const entry of terminals) {
    if (!('repeat' in entry)) count += entry.optional ? 0 : 1;
  }
  return count;
}

/** Whether a keyword is one of the type's keyword selectors in this dialect. */
function selectsType(type: ElementType, dialect: DialectId, keyword: string): boolean {
  return type.spellings.some((spelling) => spelling.dialect === dialect && 'select' in spelling && spelling.select?.by === 'keyword' && spelling.select.keywords.includes(keyword));
}

/**
 * Every terminal of a form in order, repeat groups unrolled with their counts, `#` replaced by the
 * index; `keyword` is the token whose arguments give the counts.
 */
function expandTerminals(form: Form, keyword: ParsedToken | undefined, pairs: ParsedToken[], solved: number | undefined): Slot[] {
  const count = (name: string): number => {
    if (/^\d+$/.test(name)) return Number.parseInt(name, 10);
    const source: CountSource | undefined = form.counts?.[name];
    if (source === undefined) return 0;
    if (source === 'solve') return solved ?? 0;
    if ('argument' in source) {
      return (keyword && keywordArguments(keyword)[source.argument]) ?? source.default ?? 0;
    }
    const pair = pairs.find((token) => token.key!.toUpperCase() === source.pair.toUpperCase());
    const value = pair ? Number.parseInt(pair.value!, 10) : Number.NaN;
    return Number.isNaN(value) ? 0 : value;
  };
  const slots: Slot[] = [];
  for (const entry of form.terminals) {
    if (!('repeat' in entry)) {
      slots.push({ name: entry.name, optional: entry.optional === true });
      continue;
    }
    const times = entry.repeat.split('*').reduce((product, name) => product * count(name), 1);
    for (let index = 1; index <= times; index++) {
      for (const terminal of entry.terminals as readonly Terminal[]) {
        slots.push({ name: terminal.name.replace('#', String(index)), optional: terminal.optional === true });
      }
    }
  }
  return slots;
}

/** The repeat count a form leaves to be solved from how many nodes the line has, or `undefined` when none fits. */
function solveCount(form: Form, nodes: number): number | undefined {
  let fixed = 0;
  let perRepeat = 0;
  for (const entry of form.terminals) {
    if (!('repeat' in entry)) fixed++;
    else perRepeat += entry.terminals.length * entry.repeat.split('*').filter((name) => /^\d+$/.test(name)).reduce((product, name) => product * Number.parseInt(name, 10), 1);
  }
  if (perRepeat === 0) return 0;
  const remaining = nodes - fixed;
  if (remaining < 0 || remaining % perRepeat !== 0) return undefined;
  return remaining / perRepeat;
}

/**
 * How many tokens the parser unwrapped from a parenthesised node list. The cards do not say where
 * it closed, so the closing bracket is found in the text between one token and the next: the list
 * opens after the name and closes on the same line or on a `+` line continuing it (ADR 0008).
 */
function closedNodeCount(card: Card): number {
  const { parsed, lines } = card;
  let from = { line: parsed.line, column: parsed.end };
  for (const [index, token] of parsed.tokens.entries()) {
    if (textBetween(lines, from, token).includes(')')) return index;
    from = { line: token.endLine ?? token.line, column: token.end };
  }
  return parsed.tokens.length;
}

/** The source text from one position to another, later one — across lines when they differ. */
function textBetween(lines: string[], from: { line: number; column: number }, to: { line: number; column: number }): string {
  if (to.line === from.line) return (lines[from.line - 1] ?? '').slice(from.column, to.column);
  const pieces = [(lines[from.line - 1] ?? '').slice(from.column)];
  for (let line = from.line + 1; line < to.line; line++) pieces.push(lines[line - 1] ?? '');
  pieces.push((lines[to.line - 1] ?? '').slice(0, to.column));
  return pieces.join('\n');
}

/**
 * Every spelling of ground becomes `0` — Xyce's extra spellings only once the netlist has asked
 * for them; other node names are case-insensitive unless the dialect says otherwise; PSpice's and
 * Xyce's `[SUB]` is `SUB`.
 */
function normalise(name: string, context: Context): string {
  const rules = DIALECTS[context.dialect];
  const node = rules.bracketedNodeNames && /^\[.+\]$/.test(name) ? name.slice(1, -1) : name;
  const lower = node.toLowerCase();
  const isGround = (spelling: string): boolean => (rules.caseSensitive ? spelling === node : spelling.toLowerCase() === lower);
  if (rules.ground.some(isGround)) return GROUND;
  if (context.replaceGround && rules.groundWhenReplaceGround?.some(isGround)) return GROUND;
  return rules.caseSensitive ? node : lower;
}

/** Name each node token's pin: from the form's terminals, or by the block's pin rule. */
function toPins(card: Card, nodeTokens: ParsedToken[], slots: Slot[], rule: PinRule | undefined, nameToken: ParsedToken | undefined, context: Context, ref: string): Pin[] {
  const { subcircuits, notes } = context;
  const nodes = nodeTokens.map((token) => joined(normalise(token.text, context), context));
  switch (rule) {
    case 'numbered':
      return nodes.map((node, index) => ({ name: String(index + 1), node }));
    case 'subcircuit-ports': {
      const name = nameToken!.text;
      const ports = subcircuits.get(name.toLowerCase());
      if (ports && (nodes.length < ports.required || nodes.length > ports.names.length)) {
        const count = ports.required === ports.names.length ? `${ports.names.length} ports` : `${ports.required} to ${ports.names.length} ports`;
        throw new ParseError(`${ref} connects ${nodes.length} nodes, but subcircuit ${name} has ${count}.`, at(card, nameToken!));
      }
      if (!ports) notes.push(`${capitalise(where(card))}: subcircuit ${name} of ${ref} is not defined here; its pins are numbered.`);
      return nodes.map((node, index) => ({ name: ports?.names[index] ?? String(index + 1), node }));
    }
    case 'xspice-ports':
      return xspicePins(nodeTokens, context);
    case 'hide-tied-to-common':
    case undefined:
      return nodes.map((node, index) => ({ name: slots[index]?.name ?? String(index + 1), node }));
  }
}

/**
 * XSPICE ports (ngspice M §8.1.1): a port is a node, `%type` then a node, `%vd(a b)` or
 * `%vd a b` for a differential pair, `[a b]` for a vector (a modifier before `[` applies to all of
 * it), `~a` for an inverted digital node, `null` for no connection. Pins are numbered by port:
 * `2[0]`, `2[1]` for a vector's members, `2+`, `2-` for a differential pair; an inverted node
 * keeps its `~` on the pin. `%vnam` names a voltage source, not a node, and is not drawn.
 */
function xspicePins(tokens: ParsedToken[], context: Context): Pin[] {
  const pins: Pin[] = [];
  let port = 0;
  let modifier = '';
  let vector: { port: number; index: number } | undefined;
  const differential = (text: string): boolean => /^%[vigh]d$/i.test(text);
  const push = (name: string, raw: string): void => {
    const inverted = raw.startsWith('~');
    const node = inverted ? raw.slice(1) : raw;
    if (node.toLowerCase() === 'null' || modifier.toLowerCase() === '%vnam') return;
    pins.push({ name: inverted ? `~${name}` : name, node: joined(normalise(node, context), context) });
  };
  for (const token of tokens) {
    let text = token.text;
    // `%vd(in 0)` or `%d(dout)`: a modifier glued to its node or pair.
    const glued = /^(%\w+)\((.*)\)$/.exec(text);
    if (glued) {
      port++;
      modifier = glued[1]!;
      const [a, b] = glued[2]!.split(/[\s,]+/).filter((node) => node.length > 0);
      if (differential(modifier)) {
        if (a !== undefined) push(`${port}+`, a);
        if (b !== undefined) push(`${port}-`, b);
      } else if (a !== undefined) {
        push(String(port), a);
      }
      modifier = '';
      continue;
    }
    if (/^%\w+$/.test(text)) {
      modifier = text;
      continue;
    }
    if (/^%\w+\[/.test(text)) {
      modifier = text.slice(0, text.indexOf('['));
      text = text.slice(text.indexOf('['));
    }
    if (text.startsWith('[')) {
      vector = { port: ++port, index: 0 };
      text = text.slice(1);
      if (text.length === 0) continue;
    }
    let closes = false;
    if (text.endsWith(']')) {
      closes = true;
      text = text.slice(0, -1);
    }
    if (vector) {
      if (text.length > 0) push(`${vector.port}[${vector.index++}]`, text);
      if (closes) {
        vector = undefined;
        modifier = '';
      }
      continue;
    }
    if (differential(modifier)) {
      // `%vd a b`: the pair's two nodes come as separate words.
      const pending = pins.at(-1);
      if (pending && pending.name === `${port}+` && !pins.some((pin) => pin.name === `${port}-`)) {
        push(`${port}-`, text);
        modifier = '';
      } else {
        push(`${++port}+`, text);
      }
      continue;
    }
    push(String(++port), text);
    modifier = '';
  }
  return pins;
}
