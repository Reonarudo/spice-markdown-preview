import type { ElementType } from './types';
import { PLUS_MINUS, everySpiceDialect } from './shared';

/** `V n+ n- [specification]`; Spectre `vsource (p n)`. */
export default {
  name: 'voltage source',
  spellings: [...everySpiceDialect('V'), { dialect: 'spectre', master: 'vsource' }],
  forms: [{ terminals: PLUS_MINUS, nodesEnd: 'count' }],
  tail: 'value',
  draw: { symbol: 'vsource' }
} satisfies ElementType;
