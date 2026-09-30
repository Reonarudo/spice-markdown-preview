import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `ROM(a,o)`: enable, a address lines (msb first), o outputs (RG p.384). */
export default {
  name: 'digital ROM',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['ROM'] } }],
  forms: [
    {
      terminals: [
        ...DIGITAL_SUPPLY,
        { name: 'EN', side: 'left' },
        { repeat: 'a', terminals: [{ name: 'A#', side: 'left' }] },
        { repeat: 'o', terminals: [{ name: 'out#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { a: { argument: 0 }, o: { argument: 1 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
