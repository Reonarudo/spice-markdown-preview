import type { ElementType } from './types';

/**
 * The uniform distributed RC line `U n1 n2 ncommon model L=len` (ngspice M §6.3, LTspice). PSpice
 * and Xyce read `U` as a digital primitive, HSPICE as a lumped lossy line.
 */
export default {
  name: 'RC line',
  spellings: [
    { dialect: 'ngspice', letter: 'U' },
    { dialect: 'ltspice', letter: 'U' },
    { dialect: 'spectre-spice', letter: 'U' }
  ],
  forms: [
    {
      terminals: [
        { name: 'n1', side: 'left' },
        { name: 'n2', side: 'right' },
        { name: 'common', side: 'bottom' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'RC line' } } }
} satisfies ElementType;
