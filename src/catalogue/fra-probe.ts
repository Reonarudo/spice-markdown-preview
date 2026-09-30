import type { ElementType } from './types';

/** LTspice's FRA probe `&name o+ o- i+ i-` (four nodes, no parameters). */
export default {
  name: 'FRA probe',
  spellings: [{ dialect: 'ltspice', letter: '&' }],
  forms: [
    {
      terminals: [
        { name: 'o+', side: 'right' },
        { name: 'o-', side: 'right' },
        { name: 'i+', side: 'left' },
        { name: 'i-', side: 'left' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'none',
  draw: { block: { title: { fixed: 'FRA probe' } } }
} satisfies ElementType;
