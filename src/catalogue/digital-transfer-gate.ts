import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's bidirectional transfer gates `NBTG`/`PBTG`: gate, channel 1, channel 2 (RG p.363). */
export default {
  name: 'digital transfer gate',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['NBTG', 'PBTG'] } }],
  forms: [
    {
      terminals: [...DIGITAL_SUPPLY, { name: 'gate', side: 'left' }, { name: 'ch1', side: 'left' }, { name: 'ch2', side: 'right' }],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
