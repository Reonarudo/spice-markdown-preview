import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's stimulus generators `STIM(w,format)` with w outputs and `FSTIM(k)` with k (RG p.418, 427). */
export default {
  name: 'digital stimulus',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['STIM', 'FSTIM'] } }],
  forms: [
    {
      terminals: [...DIGITAL_SUPPLY, { repeat: 'w', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { w: { argument: 0 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
