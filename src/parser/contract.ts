/**
 * What a generated parser hands to TypeScript (ADR 0008): one JSON document per file, holding
 * classified cards and at most one structural error. Everything else — nesting, node counts,
 * models, includes, notes, wording — is TypeScript's, over these cards.
 *
 * The shape is written by `grammar/driver/json.c`, once for every dialect; a change there is a
 * change here, and `CONTRACT` moves with it so a stale vendored module is refused at load.
 */

/** The version of this shape. A module returning another number is refused by the registry. */
export const CONTRACT = 1;

export interface ParserOutput {
  contract: typeof CONTRACT;
  /** Every card in file order, up to the first error; on failure the cards read so far are kept. */
  cards: Card[];
  error?: ParseError;
  /** Non-blank, non-comment lines after the first `.end`, where the scanner stopped. */
  afterEnd?: number;
}

export type Card = ElementCard | DirectiveCard;

/** A card's `line`, `column` and `end` are its head token's; tokens carry their own. */
export interface Span {
  /** 1-based source line. */
  line: number;
  /** 0-based column of the first character. */
  column: number;
  /** 0-based column one past the last character, on `endLine` when that is present. */
  end: number;
  /**
   * Tokens only: the 1-based line the token ends on, when it is not `line`. A group continued
   * across `+` lines — or a pair whose value is — ends on a later line; its `text` joins the
   * pieces with one blank where the line break and the `+` were. Cards and errors never have it.
   */
  endLine?: number;
}

export interface ElementCard extends Span {
  kind: 'element';
  /** The element name as written, e.g. `R1`, or the Spectre instance name. */
  ref: string;
  /** SPICE dialects: the element letter, upper-cased. Absent for a Spectre instance. */
  letter?: string;
  /** Spectre: the master after the node list, e.g. `resistor`. Absent in the SPICE dialects. */
  master?: string;
  /** What the grammar recognised after the letter: a keyword, a Xyce `Y` suffix, a master. */
  selector?: string;
  /** A parenthesised node list directly after the ref was unwrapped into words; overrides `nodesEnd`. */
  nodesClosed?: true;
  tokens: Token[];
}

export interface DirectiveCard extends Span {
  kind: 'directive';
  /** Lower-cased, with its leading dot in the SPICE dialects, e.g. `.model`, `.include`. */
  name: string;
  /** `.model` keeps its bare words (name, type, flags such as `pchan`) and the `level` pair only; every other directive keeps all. */
  tokens: Token[];
}

export type TokenClass = 'word' | 'pair' | 'group' | 'keyword';

export interface Token extends Span {
  class: TokenClass;
  /** Verbatim, except a `pair` written `k = v` is joined to `k=v`. */
  text: string;
  /** `pair` only. */
  key?: string;
  /** `pair` only. */
  value?: string;
}

/** The first structural error only. Node counts and drawing rules never come from the parser. */
export interface ParseError extends Span {
  /** Attached by an explicit error production; TypeScript maps it to today's wording. */
  code?: string;
  /** What the parser choked on, in the token-class vocabulary plus `newline`, `end of file`, `continuation`, `directive`. */
  found: { class: string; text: string };
  /** Bison string aliases, never internal token names; drives the generic "unexpected X; expected Y". */
  expected: string[];
}
