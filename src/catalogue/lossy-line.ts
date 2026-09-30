import type { ElementType } from './types';
import { LINE_PORTS } from './shared';

/** The LTRA lossy line `O a+ a- b+ b- model`. PSpice's `O` is a digital output and HSPICE has no `O`. */
export default {
  name: 'lossy transmission line',
  spellings: [
    { dialect: 'ngspice', letter: 'O' },
    { dialect: 'ltspice', letter: 'O' },
    { dialect: 'xyce', letter: 'O' },
    { dialect: 'spectre-spice', letter: 'O' }
  ],
  forms: [{ terminals: LINE_PORTS, nodesEnd: 'count' }],
  tail: 'model',
  draw: { block: { title: { fixed: 'lossy line' } } }
} satisfies ElementType;
