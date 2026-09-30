import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's programmable logic arrays `PLAND(i,o)` and kin, with true/complement `…C` variants: i inputs, o outputs (RG p.380–381). */
export default {
  name: 'digital PLA',
  spellings: [
    {
      dialect: 'pspice',
      letter: 'U',
      select: { by: 'keyword', keywords: ['PLAND', 'PLOR', 'PLXOR', 'PLNAND', 'PLNOR', 'PLNXOR', 'PLANDC', 'PLORC', 'PLXORC', 'PLNANDC', 'PLNORC', 'PLNXORC'] }
    }
  ],
  forms: [
    {
      terminals: [...DIGITAL_SUPPLY, { repeat: 'i', terminals: [{ name: 'in#', side: 'left' }] }, { repeat: 'o', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { i: { argument: 0 }, o: { argument: 1 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
