import type { ElementType } from './types';
import { everySpiceDialect } from './shared';

/**
 * `K L1 L2 k` couples inductors by name and connects no node; Spectre `mutual_inductor` likewise
 * (`ind1= ind2=`). Noted, never drawn (#1197).
 */
export default {
  name: 'mutual inductance',
  spellings: [...everySpiceDialect('K'), { dialect: 'spectre', master: 'mutual_inductor' }],
  forms: [{ terminals: [], nodesEnd: 'count' }],
  tail: 'value',
  draw: 'none'
} satisfies ElementType;
