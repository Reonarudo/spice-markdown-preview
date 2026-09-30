import type { ElementType } from './types';

/**
 * ngspice's coupled multiconductor line `P in1 … inN refin out1 … outN refout model [len=]`, N
 * from 1 to 8 (M §6.4.2): the model is the last positional token and N follows from the count.
 */
export default {
  name: 'coupled line',
  spellings: [{ dialect: 'ngspice', letter: 'P' }],
  forms: [
    {
      terminals: [
        { repeat: 'n', terminals: [{ name: 'in#', side: 'left' }] },
        { name: 'refin', side: 'left' },
        { repeat: 'n', terminals: [{ name: 'out#', side: 'right' }] },
        { name: 'refout', side: 'right' }
      ],
      nodesEnd: 'last-positional',
      counts: { n: 'solve' }
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'coupled line' } } }
} satisfies ElementType;
