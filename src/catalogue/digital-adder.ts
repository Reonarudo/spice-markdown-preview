import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** Xyce's full adder `U name ADD dpwr dgnd a b cin sum cout model` — three inputs, two outputs (RG §2.3.28). */
export default {
  name: 'digital adder',
  spellings: [{ dialect: 'xyce', letter: 'U', select: { by: 'keyword', keywords: ['ADD'] } }],
  forms: [
    {
      terminals: [
        ...DIGITAL_SUPPLY,
        { name: 'A', side: 'left' },
        { name: 'B', side: 'left' },
        { name: 'CIN', side: 'left' },
        { name: 'SUM', side: 'right' },
        { name: 'COUT', side: 'right' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
