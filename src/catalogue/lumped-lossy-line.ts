import type { ElementType } from './types';

/** HSPICE's lumped lossy line `U in1 [… in5] refin out1 [… out5] refout model L=` (UG p.158–159). */
export default {
  name: 'lumped lossy line',
  spellings: [{ dialect: 'hspice', letter: 'U' }],
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
  draw: { block: { title: { fixed: 'lossy line' } } }
} satisfies ElementType;
