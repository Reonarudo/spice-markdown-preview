import type { ElementType } from './types';

/** Xyce's lumped transmission line `YTRANSLINE name in out model len= lumps=` (RG §2.3.26). */
export default {
  name: 'lumped transmission line',
  spellings: [{ dialect: 'xyce', letter: 'Y', select: { by: 'suffix', suffixes: ['TRANSLINE'] } }],
  forms: [{ terminals: [{ name: 'in', side: 'left' }, { name: 'out', side: 'right' }], nodesEnd: 'count' }],
  tail: 'model',
  draw: { block: { title: { fixed: 'lumped line' } } }
} satisfies ElementType;
