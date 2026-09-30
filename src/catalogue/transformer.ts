import type { ElementType } from './types';

/** Spectre's ideal `transformer (t1 b1 t2 b2)` (REF03 p.667). */
export default {
  name: 'transformer',
  spellings: [{ dialect: 'spectre', master: 'transformer' }],
  forms: [
    {
      terminals: [
        { name: 't1', side: 'left' },
        { name: 'b1', side: 'left' },
        { name: 't2', side: 'right' },
        { name: 'b2', side: 'right' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'none',
  draw: { block: { title: { fixed: 'transformer' } } }
} satisfies ElementType;
