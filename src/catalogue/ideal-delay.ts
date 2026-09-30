import type { ElementType } from './types';

/** Xyce's ideal delay `YDELAY name out+ out- in+ in- TD=` (RG §2.3.27). */
export default {
  name: 'delay',
  spellings: [{ dialect: 'xyce', letter: 'Y', select: { by: 'suffix', suffixes: ['DELAY'] } }],
  forms: [
    {
      terminals: [
        { name: 'out+', side: 'right' },
        { name: 'out-', side: 'right' },
        { name: 'in+', side: 'left' },
        { name: 'in-', side: 'left' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'none',
  draw: { block: { title: { fixed: 'delay' } } }
} satisfies ElementType;
