import type { ElementType } from './types';
import { PLUS_MINUS, everySpiceDialect } from './shared';

/**
 * `D anode cathode model`; ngspice allows a third, thermal node `tj` before the model (M §7.2),
 * so the nodes end where the model begins. Spectre `diode (a c)`.
 */
export default {
  name: 'diode',
  spellings: [...everySpiceDialect('D'), { dialect: 'spectre', master: 'diode' }],
  forms: [{ terminals: [...PLUS_MINUS, { name: 'tj', side: 'right', optional: true }], nodesEnd: 'model' }],
  tail: 'model',
  draw: { symbol: 'diode' }
} satisfies ElementType;
