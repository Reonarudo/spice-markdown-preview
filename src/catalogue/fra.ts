import type { ElementType } from './types';

/** LTspice's frequency response analyzer `@name in out [zm] fstart= fend= …` (two nodes). */
export default {
  name: 'FRA',
  spellings: [{ dialect: 'ltspice', letter: '@' }],
  forms: [{ terminals: [{ name: 'in', side: 'left' }, { name: 'out', side: 'right' }], nodesEnd: 'count' }],
  tail: 'value',
  draw: { block: { title: { fixed: 'FRA' } } }
} satisfies ElementType;
