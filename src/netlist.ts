/**
 * A SPICE netlist reader for drawing, not simulating: it keeps every element's kind, pins and value
 * and skips everything that only matters to a simulator.
 *
 * Total by construction: every input yields either a netlist or one error naming a line and
 * column. Nothing is read from disk here: `.include` and `.lib` are expanded from the files the
 * caller supplies, and noted and skipped when it supplies none.
 */
import { IncludePathError, resolveInclude } from './include-paths';
import { elementTypeForLetter, type ElementTypeId, type SpellingHints } from './catalogue/index';
import type { DialectId } from './catalogue/types';

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

interface Token extends Position {
  text: string;
}

/** One element or directive, after continuation lines are joined and comments removed. */
interface Card {
  tokens: Token[];
  line: number;
  file: string;
}

class ParseError extends Error {
  constructor(message: string, readonly at: Position) {
    super(message);
  }
}

/** Letters drawn as boxes, with how many nodes they take and what the box says. */
const BLOCKS: Record<string, { nodes: number; title: string }> = {
  E: { nodes: 4, title: 'VCVS' },
  G: { nodes: 4, title: 'VCCS' },
  F: { nodes: 2, title: 'CCCS' },
  H: { nodes: 2, title: 'CCVS' },
  B: { nodes: 2, title: 'B source' },
  J: { nodes: 3, title: 'JFET' },
  Z: { nodes: 3, title: 'MESFET' },
  S: { nodes: 4, title: 'switch' },
  W: { nodes: 2, title: 'switch' },
  T: { nodes: 4, title: 'line' },
  O: { nodes: 4, title: 'lossy line' }
};

/** Pin names of block kinds with conventional terminals; otherwise pins are numbered. */
const BLOCK_PINS: Record<string, string[]> = {
  E: ['n+', 'n-', 'nc+', 'nc-'],
  G: ['n+', 'n-', 'nc+', 'nc-'],
  F: ['n+', 'n-'],
  H: ['n+', 'n-'],
  B: ['n+', 'n-'],
  J: ['D', 'G', 'S'],
  Z: ['D', 'G', 'S'],
  S: ['n+', 'n-', 'nc+', 'nc-'],
  W: ['n+', 'n-'],
  T: ['A+', 'A-', 'B+', 'B-'],
  O: ['A+', 'A-', 'B+', 'B-']
};

/**
 * Read a netlist. `includes` supplies the files `.include` and `.lib` name; without it, every
 * include is noted and skipped. `dialect` names the generated parser the netlist is read with
 * (ADR 0008); the reader below still reads every dialect as ngspice until that parser is wired in.
 */
export function parseNetlist(source: string, includes?: IncludeSet, dialect: DialectId = 'ngspice'): ParseResult {
  try {
    return { ok: true, netlist: read(source, includes ?? { files: {}, unavailable: 'no files are available here' }) };
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
    const cards = toCards(text, from);
    cards.forEach((card, index) => {
      const target = includeTarget(cards, index);
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

/** Where a card is, for notes and messages: `line 4` in the fence, `models.lib line 4` elsewhere. */
function where(position: { line: number; file: string }): string {
  return position.file ? `${position.file} line ${position.line}` : `line ${position.line}`;
}

function capitalise(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

/**
 * Whether the card at `index` includes a file, and which: `.include path`, `.inc path`,
 * `.lib path section`, or `.lib path` when no `.endl` follows (LTspice's whole-file `.lib`).
 * A one-argument `.lib` that an `.endl` closes defines a section instead.
 */
function includeTarget(cards: Card[], index: number): { path: Token; section?: Token } | undefined {
  const [head, path, section] = cards[index]!.tokens;
  const word = head!.text.toLowerCase();
  if (word === '.include' || word === '.inc') return path ? { path } : undefined;
  if (word !== '.lib' || !path) return undefined;
  if (section) return { path, section };
  return isSectionStart(cards, index) ? undefined : { path };
}

/**
 * Whether a one-argument `.lib` opens a section. Sections do not nest, so it does when the next
 * section marker — another one-argument `.lib`, or `.endl` — is an `.endl`.
 */
function isSectionStart(cards: Card[], index: number): boolean {
  if (!isOneArgumentLib(cards[index]!)) return false;
  const next = cards.slice(index + 1).find((later) => isOneArgumentLib(later) || later.tokens[0]!.text.toLowerCase() === '.endl');
  return next !== undefined && !isOneArgumentLib(next);
}

function isOneArgumentLib(card: Card): boolean {
  return card.tokens.length === 2 && card.tokens[0]!.text.toLowerCase() === '.lib';
}

/**
 * Replace every include with the cards it names, recursively, as SPICE does before reading
 * anything else. Section definitions (`.lib name` … `.endl`) are dropped unless a `.lib path name`
 * selected them.
 */
function expand(cards: Card[], from: string, includes: IncludeSet, notes: string[], stack: string[]): Card[] {
  const out: Card[] = [];
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!;
    const head = card.tokens[0]!;
    const word = head.text.toLowerCase();
    if (isSectionStart(cards, index)) {
      while (index < cards.length && cards[index]!.tokens[0]!.text.toLowerCase() !== '.endl') index++;
      continue;
    }
    if (word === '.endl') continue;
    // Nothing after `.end` is read. In an included file it ends only that file, so that a model
    // library ending in `.end` does not cut off the rest of the fence.
    if (word === '.end') {
      if (from === '') out.push(card);
      break;
    }
    if (word === '.include' || word === '.inc' || word === '.lib') {
      const target = includeTarget(cards, index);
      if (!target) throw new ParseError(`${head.text} needs a file name.`, end(card));
      out.push(...include(card, target, from, includes, notes, stack));
      continue;
    }
    out.push(card);
  }
  return out;
}

function include(card: Card, target: { path: Token; section?: Token }, from: string, includes: IncludeSet, notes: string[], stack: string[]): Card[] {
  const { path, section } = target;
  let key: string;
  try {
    key = resolveInclude(from, path.text);
  } catch (error) {
    if (error instanceof IncludePathError) throw new ParseError(`${error.message} (${path.text})`, path);
    throw error;
  }
  if (includes.unavailable !== undefined) {
    notes.push(`${capitalise(where(card))}: ${card.tokens[0]!.text} ${path.text} is not read: ${includes.unavailable}.`);
    return [];
  }
  if (stack.includes(key)) throw new ParseError(`${path.text} includes itself.`, path);
  if (stack.length >= MAX_INCLUDE_DEPTH) throw new ParseError(`Includes are nested more than ${MAX_INCLUDE_DEPTH} deep.`, path);
  const entry = includes.files[key];
  if (entry === undefined) throw new ParseError(`${path.text} could not be read.`, path);
  if (typeof entry !== 'string') throw new ParseError(`${path.text} could not be read: ${entry.error}`, path);
  // Every position in the included file points back at this include in the fence.
  const anchor = path.anchor ?? { line: path.line, column: path.column };
  let cards = toCards(entry, key, anchor);
  if (section) {
    const name = section.text.toLowerCase();
    const start = cards.findIndex((c) => c.tokens.length === 2 && c.tokens[0]!.text.toLowerCase() === '.lib' && c.tokens[1]!.text.toLowerCase() === name);
    if (start === -1) throw new ParseError(`${path.text} has no section ${section.text}.`, section);
    const stop = cards.findIndex((c, i) => i > start && c.tokens[0]!.text.toLowerCase() === '.endl');
    cards = cards.slice(start + 1, stop === -1 ? undefined : stop);
  }
  return expand(cards, key, includes, notes, [...stack, key]);
}

function read(source: string, includes: IncludeSet): Netlist {
  const notes: string[] = [];
  const cards = expand(toCards(source, ''), '', includes, notes, []);
  const models = new Map<string, string>();
  const subcircuits = new Map<string, string[]>();
  const elements: Card[] = [];

  // First pass: directives, so that a model or subcircuit defined below its use still counts.
  let inside: { kind: 'subckt' | 'control'; card: Card } | undefined;
  for (const card of cards) {
    const head = card.tokens[0]!;
    const word = head.text.toLowerCase();
    if (inside) {
      if ((inside.kind === 'subckt' && word === '.ends') || (inside.kind === 'control' && word === '.endc')) {
        inside = undefined;
      }
      continue;
    }
    if (word === '.end') break;
    if (word === '.subckt') {
      const [, name, ...rest] = card.tokens;
      if (!name) throw new ParseError('.subckt needs a name.', head);
      const ports: string[] = [];
      for (const token of rest) {
        if (/^params:$/i.test(token.text) || token.text.includes('=')) break;
        ports.push(token.text);
      }
      subcircuits.set(name.text.toLowerCase(), ports);
      inside = { kind: 'subckt', card };
      continue;
    }
    if (word === '.control') {
      inside = { kind: 'control', card };
      continue;
    }
    if (word === '.model') {
      const [, name, type] = card.tokens;
      if (name && type) models.set(name.text.toLowerCase(), type.text.replace(/\(.*$/, '').toLowerCase());
      continue;
    }
    if (word.startsWith('.')) continue;
    elements.push(card);
  }
  if (inside) {
    const end = inside.kind === 'subckt' ? '.ends' : '.endc';
    throw new ParseError(`${inside.card.tokens[0]!.text} has no matching ${end}.`, inside.card.tokens[0]!);
  }

  const parts: Part[] = [];
  const seen = new Map<string, Card>();
  for (const card of elements) {
    const part = toPart(card, models, subcircuits, notes);
    if (!part) continue;
    const key = part.ref.toLowerCase();
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      throw new ParseError(`Duplicate element ${part.ref}; it is also defined on ${where(earlier)}.`, card.tokens[0]!);
    }
    seen.set(key, card);
    parts.push(part);
    if (parts.length > MAX_PARTS) {
      throw new ParseError(`More than ${MAX_PARTS} elements; split the circuit into several fences.`, card.tokens[0]!);
    }
  }
  if (parts.length === 0) {
    throw new ParseError('No elements found. Write one element per line, e.g. R1 in out 10k.', { line: 1, column: 0, file: '' });
  }
  return { parts, notes };
}

/** Split into cards: drop comments, join `+` continuation lines, keep every token's position. */
function toCards(source: string, file: string, anchor?: Position['anchor']): Card[] {
  const cards: Card[] = [];
  source.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const text = stripComment(raw.replace(/\r$/, ''));
    const trimmed = text.trimStart();
    if (!trimmed || trimmed.startsWith('*')) return;
    const tokens = tokenize(text, { line, column: 0, file, ...(anchor ? { anchor } : {}) });
    if (trimmed.startsWith('+')) {
      const previous = cards.at(-1);
      if (!previous) throw new ParseError('A continuation line (+) has nothing to continue.', tokens[0]!);
      // The `+` itself is not a token of the card it continues.
      const first = tokens[0]!;
      const rest = first.text === '+' ? tokens.slice(1) : [{ ...first, text: first.text.slice(1), column: first.column + 1 }, ...tokens.slice(1)];
      previous.tokens.push(...rest);
      return;
    }
    cards.push({ tokens, line, file });
  });
  return cards;
}

/** Remove `;` comments anywhere, and `$` or `//` comments that follow whitespace (ngspice). */
function stripComment(line: string): string {
  const match = /;|(?<=\s)(?:\$|\/\/)/.exec(line);
  return match ? line.slice(0, match.index) : line;
}

/**
 * Split on whitespace and commas, but keep a parenthesised group — `SIN(0 1 1k)` — and a
 * `name = value` pair together, so that values stay one token.
 */
function tokenize(text: string, at: Position): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /[\s,]/.test(text[index]!)) index++;
    if (index >= text.length) break;
    const start = index;
    let depth = 0;
    while (index < text.length) {
      const char = text[index]!;
      if (char === '(' || char === '{') depth++;
      else if ((char === ')' || char === '}') && depth > 0) depth--;
      else if (depth === 0 && /[\s,]/.test(char)) break;
      index++;
    }
    tokens.push({ ...at, text: text.slice(start, index), column: start });
  }
  // Rejoin `W = 1u` into `W=1u`, which ngspice also accepts.
  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i]!.text === '=') {
      tokens.splice(i - 1, 3, { ...tokens[i - 1]!, text: `${tokens[i - 1]!.text}=${tokens[i + 1]!.text}` });
      i--;
    }
  }
  return tokens;
}

function toPart(card: Card, models: Map<string, string>, subcircuits: Map<string, string[]>, notes: string[]): Part | undefined {
  const [head, ...args] = card.tokens as [Token, ...Token[]];
  const ref = head.text;
  if (!/^[A-Za-z][\w.+\-#!@$%&|[\]]*$/.test(ref)) {
    throw new ParseError(`"${ref}" is not an element name. Element names start with a letter, e.g. R1.`, head);
  }
  const letter = ref[0]!.toUpperCase();
  const line = card.line;
  const origin = card.file ? { file: card.file } : {};
  const at = capitalise(where(card));
  // This reader reads ngspice only; the catalogue's ngspice spellings name the element type.
  const type = (hints: SpellingHints = {}): ElementTypeId => {
    const found = elementTypeForLetter('ngspice', letter, hints);
    if (found === undefined) throw new ParseError(`Element type ${letter} (${ref}) is not supported.${titleHint(card)}`, head);
    return found;
  };

  const nodes = (count: number): string[] => {
    const found = args.slice(0, count).filter((token) => !token.text.includes('='));
    if (found.length < count) {
      // Point at the first token that is not a node, or just past the end of the element.
      const where = args[found.length] ?? end(card);
      throw new ParseError(`${ref} needs ${count} nodes; found ${found.length}.${titleHint(card)}`, where);
    }
    return found.map((token) => normalise(token.text));
  };
  const rest = (from: number): string => args.slice(from).map((token) => token.text).join(' ');
  const needValue = (from: number, what: string): void => {
    if (args.length <= from) {
      throw new ParseError(`${ref} needs ${what} after its nodes.${titleHint(card)}`, end(card));
    }
  };

  switch (letter) {
    case 'R':
    case 'C':
    case 'L': {
      const [a, b] = nodes(2);
      needValue(2, 'a value');
      const kind = letter === 'R' ? 'resistor' : letter === 'C' ? 'capacitor' : 'inductor';
      return { ref, type: type(), kind, pins: [{ name: 'A', node: a! }, { name: 'B', node: b! }], value: rest(2), line, ...origin };
    }
    case 'D': {
      const [anode, cathode] = nodes(2);
      needValue(2, 'a model name');
      return { ref, type: type(), kind: 'diode', pins: [{ name: '+', node: anode! }, { name: '-', node: cathode! }], value: rest(2), line, ...origin };
    }
    case 'V':
    case 'I': {
      const [plus, minus] = nodes(2);
      return {
        ref,
        type: type(),
        kind: letter === 'V' ? 'vsource' : 'isource',
        pins: [{ name: '+', node: plus! }, { name: '-', node: minus! }],
        value: rest(2),
        line,
        ...origin
      };
    }
    case 'Q': {
      // Q c b e [substrate] model: the model is the first token that is a defined model, or else
      // the fourth token unless a fifth, non-numeric one follows it.
      const isModel = (token: Token | undefined) => token !== undefined && models.has(token.text.toLowerCase());
      let count = 3;
      if (!isModel(args[3]) && (isModel(args[4]) || (args[4] && !isNumeric(args[4].text) && !args[4].text.includes('=')))) count = 4;
      const [c, b, e, substrate] = nodes(count);
      needValue(count, 'a model name');
      const model = args[count]!.text;
      const modelType = models.get(model.toLowerCase());
      if (modelType === undefined) notes.push(`${at}: model ${model} of ${ref} is not defined here; drawn as NPN.`);
      if (substrate !== undefined) notes.push(`${at}: the substrate connection of ${ref} is not drawn.`);
      return {
        ref,
        type: type(modelType === undefined ? {} : { modelType }),
        kind: modelType === 'pnp' ? 'pnp' : 'npn',
        pins: [{ name: 'C', node: c! }, { name: 'B', node: b! }, { name: 'E', node: e! }],
        value: rest(count),
        line,
        ...origin
      };
    }
    case 'M': {
      const [d, g, s, b] = nodes(4);
      needValue(4, 'a model name');
      const model = args[4]!.text;
      const modelType = models.get(model.toLowerCase());
      if (modelType === undefined) notes.push(`${at}: model ${model} of ${ref} is not defined here; drawn as NMOS.`);
      return {
        ref,
        type: type(modelType === undefined ? {} : { modelType }),
        kind: modelType === 'pmos' ? 'pmos' : 'nmos',
        pins: [{ name: 'D', node: d! }, { name: 'G', node: g! }, { name: 'S', node: s! }, { name: 'B', node: b! }],
        value: rest(4),
        line,
        ...origin
      };
    }
    case 'X': {
      // X n1 n2 … name [params: …] [k=v …]: the subcircuit name is the last positional token.
      let positional = args.findIndex((token) => /^params:$/i.test(token.text) || token.text.includes('='));
      if (positional === -1) positional = args.length;
      if (positional < 1) throw new ParseError(`${ref} needs a subcircuit name.`, end(card));
      const name = args[positional - 1]!.text;
      const ports = subcircuits.get(name.toLowerCase());
      const count = positional - 1;
      if (ports && ports.length !== count) {
        throw new ParseError(`${ref} connects ${count} nodes, but subcircuit ${name} has ${ports.length} ports.`, args[positional - 1]!);
      }
      if (!ports) notes.push(`${at}: subcircuit ${name} of ${ref} is not defined here; its pins are numbered.`);
      const pins = args.slice(0, count).map((token, index) => ({ name: ports?.[index] ?? String(index + 1), node: normalise(token.text) }));
      return { ref, type: type(), kind: 'block', pins, value: rest(positional), title: name, line, ...origin };
    }
    case 'K':
      notes.push(`${at}: coupling ${ref} (${rest(0)}) is not drawn.`);
      return undefined;
    default: {
      const block = BLOCKS[letter];
      if (!block) {
        throw new ParseError(`Element type ${letter} (${ref}) is not supported.${titleHint(card)}`, head);
      }
      const found = nodes(block.nodes);
      const names = BLOCK_PINS[letter]!;
      return {
        ref,
        type: type(),
        kind: 'block',
        pins: found.map((node, index) => ({ name: names[index]!, node })),
        value: rest(block.nodes),
        title: block.title,
        line,
        ...origin
      };
    }
  }
}

/** Just past a card's last token, where a missing one would go. */
function end(card: Card): Position {
  const last = card.tokens.at(-1)!;
  return { ...last, column: last.column + last.text.length + 1 };
}

/** Every spelling of ground becomes `0`; other node names are case-insensitive, as in SPICE. */
function normalise(node: string): string {
  const lower = node.toLowerCase();
  return lower === 'gnd' || lower === '0' ? GROUND : lower;
}

function isNumeric(text: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z]*$/i.test(text);
}

/**
 * A SPICE file's first line is its title, which in a fence usually fails to parse as an element.
 * Say so where it would help.
 */
function titleHint(card: Card): string {
  return card.line === 1 && card.file === '' ? ' If this line is a title, start it with * to make it a comment.' : '';
}
