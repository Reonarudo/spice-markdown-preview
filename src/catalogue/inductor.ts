import type { ElementType } from './types';
import { A_B, everySpiceDialect } from './shared';

/** `L n+ n- value` everywhere; Spectre `inductor`. HSPICE's `L … RELUCTANCE=` is the reluctor instead. */
export default {
  name: 'inductor',
  spellings: [...everySpiceDialect('L'), { dialect: 'spectre', master: 'inductor' }],
  forms: [{ terminals: A_B, nodesEnd: 'count' }],
  tail: 'value',
  draw: { symbol: 'inductor' }
} satisfies ElementType;
