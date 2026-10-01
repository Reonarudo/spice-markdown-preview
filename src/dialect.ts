/**
 * Which dialect a fence is read in: the `dialect` attribute, else the `spice.dialect` setting,
 * else ngspice. Decided on the map's naming ticket; kept free of `vscode` so the rule is testable.
 */
import type { DialectId } from './catalogue/types';
import { PUBLIC_DIALECTS } from './catalogue/dialects';

/** A dialect an author may name. `spectre-spice` is internal: only `simulator lang=` enters it. */
export type PublicDialect = Exclude<DialectId, 'spectre-spice'>;

export const DEFAULT_DIALECT: PublicDialect = 'ngspice';

/** The accepted spellings, for the setting's enum and for diagnostics. */
export const DIALECT_NAMES: readonly PublicDialect[] = PUBLIC_DIALECTS as readonly PublicDialect[];

/** The dialect a value names, matched case-insensitively with no aliases; `undefined` for anything else. */
export function publicDialect(value: unknown): PublicDialect | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().toLowerCase();
  return DIALECT_NAMES.find((dialect) => dialect === name);
}

/** Fence attribute, then setting, then ngspice. Either may already have been dropped as unknown. */
export function chooseDialect(attribute: PublicDialect | undefined, setting: PublicDialect | undefined): PublicDialect {
  return attribute ?? setting ?? DEFAULT_DIALECT;
}
