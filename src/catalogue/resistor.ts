import type { ElementType } from './types';
import { A_B, everySpiceDialect } from './shared';

/**
 * `R n+ n- value` in every SPICE dialect; Spectre `resistor` with an optional third (bulk)
 * terminal. LTspice's `I … R=` "is not a current source at all, but a resistor", and `B … R=` is a
 * behavioural resistor; both are drawn as one (#1197).
 */
export default {
  name: 'resistor',
  spellings: [
    ...everySpiceDialect('R'),
    { dialect: 'ltspice', letter: 'I', select: { by: 'pair', keys: ['R'] } },
    { dialect: 'ltspice', letter: 'B', select: { by: 'pair', keys: ['R'] } },
    { dialect: 'spectre', master: 'resistor' }
  ],
  forms: [
    { terminals: A_B, nodesEnd: 'count' },
    { dialects: ['spectre'], terminals: [...A_B, { name: 'bulk', side: 'right', optional: true }], nodesEnd: 'count' }
  ],
  tail: 'value',
  draw: { symbol: 'resistor' }
} satisfies ElementType;
