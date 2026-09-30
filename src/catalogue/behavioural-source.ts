import type { ElementType } from './types';
import { PLUS_MINUS } from './shared';

/**
 * The arbitrary source `B n+ n- V=expr` or `I=expr` (ngspice M §5.1.1, LTspice, Xyce). LTspice's
 * `B … R=` is the resistor. PSpice's `B` is a GaAsFET and HSPICE's an IBIS buffer.
 */
export default {
  name: 'behavioural source',
  spellings: [
    { dialect: 'ngspice', letter: 'B' },
    { dialect: 'ltspice', letter: 'B' },
    { dialect: 'xyce', letter: 'B' },
    { dialect: 'spectre-spice', letter: 'B' }
  ],
  forms: [{ terminals: PLUS_MINUS, nodesEnd: 'count' }],
  tail: 'value',
  draw: { block: { title: { fixed: 'B source' } } }
} satisfies ElementType;
