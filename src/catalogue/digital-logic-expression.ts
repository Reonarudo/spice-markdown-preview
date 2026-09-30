import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `LOGICEXP(i,o)`: i inputs, o outputs, then `LOGIC:` assignments (RG p.397). */
export default {
  name: 'digital logic expression',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['LOGICEXP'] } }],
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
