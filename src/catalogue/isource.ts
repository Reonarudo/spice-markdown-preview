import type { ElementType } from './types';
import { PLUS_MINUS, everySpiceDialect } from './shared';

/** `I n+ n- [specification]`; Spectre `isource (sink src)`. LTspice's `I … R=` is the resistor. */
export default {
  name: 'current source',
  spellings: [...everySpiceDialect('I'), { dialect: 'spectre', master: 'isource' }],
  forms: [{ terminals: PLUS_MINUS, nodesEnd: 'count' }],
  tail: 'value',
  draw: { symbol: 'isource' }
} satisfies ElementType;
