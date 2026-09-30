import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `PINDLY(p,e,r)`: p inputs, e enables, r references, p outputs; only an I/O model (RG p.401–402). */
export default {
  name: 'digital pin delay',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['PINDLY'] } }],
  forms: [
    {
      terminals: [
        ...DIGITAL_SUPPLY,
        { repeat: 'p', terminals: [{ name: 'in#', side: 'left' }] },
        { repeat: 'e', terminals: [{ name: 'en#', side: 'left' }] },
        { repeat: 'r', terminals: [{ name: 'ref#', side: 'left' }] },
        { repeat: 'p', terminals: [{ name: 'out#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { p: { argument: 0 }, e: { argument: 1 }, r: { argument: 2 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
