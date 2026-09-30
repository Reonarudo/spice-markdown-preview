import type { ElementType } from './types';

/**
 * HSPICE's reluctor: `L n1+ n1- … nN+ nN- RELUCTANCE=(…)`, an even number of nodes (UG p.141–152).
 * Told from an inductor by the `RELUCTANCE=` pair.
 */
export default {
  name: 'reluctor',
  spellings: [{ dialect: 'hspice', letter: 'L', select: { by: 'pair', keys: ['RELUCTANCE'] } }],
  forms: [
    {
      terminals: [{ repeat: 'n', terminals: [{ name: 'n#+', side: 'left' }, { name: 'n#-', side: 'right' }] }],
      nodesEnd: 'all-positional',
      counts: { n: 'solve' }
    }
  ],
  tail: 'none',
  draw: { block: { title: { fixed: 'reluctor' } } }
} satisfies ElementType;
