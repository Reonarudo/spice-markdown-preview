/**
 * The element catalogue's schema (ADR 0007): one data module per element type says how each
 * dialect spells it, which terminals its forms connect, and how it is drawn.
 *
 * Entries are data only. A rule that needs code — hiding pins tied to a common terminal,
 * numbering XSPICE ports — is a named string that `schematic.ts` maps to a function. The generated
 * grammars classify an element (letter, selector keyword or master, tokens); TypeScript applies the
 * forms below to decide where its nodes end.
 */
import type { ElementTypeId } from './index';

export type { ElementTypeId };

/** The dialects a fence may be read in, plus Spectre's SPICE mode, which only `simulator lang=` selects. */
export type DialectId = 'ngspice' | 'ltspice' | 'pspice' | 'hspice' | 'xyce' | 'spectre' | 'spectre-spice';

export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * How one dialect spells an element type: a leading letter in the SPICE dialects, a master name in
 * native Spectre. Several types may share a letter; then each carries a `select` saying how it is
 * told apart, and at most one — the letter's fallback — has none.
 */
export type Spelling =
  | { dialect: Exclude<DialectId, 'spectre'>; letter: string; select?: Select }
  /** The master `*` is the fallback for a master the catalogue does not name: a subcircuit or module. */
  | { dialect: 'spectre'; master: string };

/** What tells one element type from another sharing its letter. */
export type Select =
  /** The `.model` type of the element's model, optionally only at these `LEVEL`s. */
  | { by: 'model-type'; types: readonly string[]; levels?: readonly number[] }
  /** The type glued to a Xyce `Y`: `YMEMRISTOR`. */
  | { by: 'suffix'; suffixes: readonly string[] }
  /** A keyword token on the line: a digital `U` primitive type, an LTspice `A` function. */
  | { by: 'keyword'; keywords: readonly string[] }
  /** A `key=value` pair on the line, by key: LTspice `I … R=` is a resistor. */
  | { by: 'pair'; keys: readonly string[] };

export interface Terminal {
  /** The pin name. In a repeated group, `#` is replaced by the 1-based index: `in#` → `in1`, `in2`. */
  name: string;
  side: Side;
  /** May be left off the line; the form's `nodesEnd` rule decides whether it was. */
  optional?: true;
}

/** Terminals repeated `repeat` times in sequence, e.g. `nc1+ nc1- nc2+ nc2-`. */
export interface TerminalGroup {
  /** A count name from the form's `counts`, or a product of them and digits: `n`, `n*g`, `2*g`. */
  repeat: string;
  terminals: readonly Terminal[];
}

export type Terminals = readonly (Terminal | TerminalGroup)[];

/** Where a repeat count comes from. */
export type CountSource =
  /** The i-th number in the parentheses after the matched keyword: `POLY(2)`, `NANDA(2,4)`. */
  | { argument: number; default?: number }
  /** The value of a `key=value` pair: HSPICE `W … N=3`. */
  | { pair: string }
  /** Solved from how many nodes the line has, e.g. `2n + 2` conductors. */
  | 'solve';

/**
 * Where an element's nodes end:
 * - `count`: exactly the form's terminals (optional ones may be missing from the end);
 * - `model`: the required terminals, then more until a token names a defined model or a value;
 * - `last-positional`: every positional token but the last, which is a subcircuit, model or master;
 * - `all-positional`: every positional token before the first `key=value` pair.
 */
export type NodesEnd = 'count' | 'model' | 'last-positional' | 'all-positional';

/** The text that selects a form: a keyword after the output nodes, or a pair on the line. */
export type Match =
  | { keyword: readonly string[] }
  | { pair: readonly string[]; values?: readonly string[] };

export interface Form {
  /** Which text selects this form. The form without `match` is the type's default. */
  match?: Match;
  /** Only in these dialects; otherwise in every dialect that spells the type. */
  dialects?: readonly DialectId[];
  terminals: Terminals;
  nodesEnd: NodesEnd;
  counts?: Readonly<Record<string, CountSource>>;
}

/** What follows the nodes — for the error wording only; the tail is read generically as the value. */
export type Tail = 'value' | 'model' | 'none';

/** A symbol from `symbols.svg`, or one chosen by the model. */
export type SymbolChoice =
  | string
  | {
      default: string;
      /** By the `.model` type: `pnp` → `pnp`. */
      byModelType?: Readonly<Record<string, string>>;
      /** By a bare word on the `.model` line: ngspice `vdmos … pchan`. */
      byModelFlag?: Readonly<Record<string, string>>;
      /** By a `key=value` on the model: Spectre `type=pnp`. */
      byModelParameter?: Readonly<Record<string, Readonly<Record<string, string>>>>;
      /** What the note says when the model is not defined: `drawn as NPN`. */
      note: string;
    };

/** What a block's title says. */
export type Title =
  | { fixed: string }
  /** The `.model` type: an XSPICE code model's `d_nand`. */
  | 'model-type'
  /** The Xyce `Y` suffix: `MEMRISTOR`. */
  | 'suffix'
  /** The selecting keyword: LTspice `A`'s `AND`. */
  | 'keyword'
  /** The keyword with its parentheses: PSpice `NAND(2)`. */
  | 'keyword-with-arguments'
  /** The last positional token: a subcircuit name or a Spectre master. */
  | 'master';

/** Named pin rules `schematic.ts` implements. */
export type PinRule =
  /** Pins named by position, `1`, `2`, …; the netlist cannot know their names. */
  | 'numbered'
  /** The `.subckt` port names, else numbered. */
  | 'subcircuit-ports'
  /** XSPICE ports: `[…]` members become `2[0]`, `2[1]`; `%vd(a b)` becomes `2+`, `2-`; `null` is not drawn; `~` is kept. */
  | 'xspice-ports'
  /** A pin whose node is the common terminal's is unused and not drawn (LTspice `A`, terminal 8). */
  | 'hide-tied-to-common';

export interface Block {
  title: Title;
  /** Appended in parentheses when the model decides it: `IGBT (P)`. */
  polarity?: { byModelType: Readonly<Record<string, string>> };
  pins?: PinRule;
}

export type Draw =
  | { symbol: SymbolChoice }
  | { block: Block }
  /** Connects no node: a coupling. Noted, never drawn. */
  | 'none';

export interface ElementType {
  /** As the README table and notes name it. */
  name: string;
  spellings: readonly Spelling[];
  /** At least one; exactly one without `match` per dialect it applies to. */
  forms: readonly Form[];
  tail: Tail;
  draw: Draw;
}
