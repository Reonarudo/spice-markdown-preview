import type { ElementType } from './types';

/** PSpice's digital-to-analog interface `N interface low high model DGTLNET=net iomodel` (RG p.434–436). */
export default {
  name: 'digital input',
  spellings: [{ dialect: 'pspice', letter: 'N' }],
  forms: [
    {
      terminals: [
        { name: 'out', side: 'right' },
        { name: 'low', side: 'left' },
        { name: 'high', side: 'left' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'digital input' } } }
} satisfies ElementType;
