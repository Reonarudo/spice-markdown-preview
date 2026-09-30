import type { ElementType } from './types';

/** ngspice's single lossy line `Y n1 ref1 n2 ref2 model [len=]` (M §6.4.1). Xyce's `Y` is a device family. */
export default {
  name: 'lossy line (TXL)',
  spellings: [{ dialect: 'ngspice', letter: 'Y' }],
  forms: [
    {
      terminals: [
        { name: 'in', side: 'left' },
        { name: 'refin', side: 'left' },
        { name: 'out', side: 'right' },
        { name: 'refout', side: 'right' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'lossy line' } } }
} satisfies ElementType;
