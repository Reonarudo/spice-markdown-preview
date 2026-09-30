import type { ElementType } from './types';

/**
 * HSPICE's coupled lossy line `W in1 … inN refin out1 … outN refout N=n L=len …`, any number of
 * conductors, nodes and parameters possibly mixed (UG p.154–158). N comes from the `N=` pair.
 */
export default {
  name: 'coupled lossy line',
  spellings: [{ dialect: 'hspice', letter: 'W' }],
  forms: [
    {
      terminals: [
        { repeat: 'n', terminals: [{ name: 'in#', side: 'left' }] },
        { name: 'refin', side: 'left' },
        { repeat: 'n', terminals: [{ name: 'out#', side: 'right' }] },
        { name: 'refout', side: 'right' }
      ],
      nodesEnd: 'all-positional',
      counts: { n: { pair: 'N' } }
    }
  ],
  tail: 'none',
  draw: { block: { title: { fixed: 'coupled line' } } }
} satisfies ElementType;
