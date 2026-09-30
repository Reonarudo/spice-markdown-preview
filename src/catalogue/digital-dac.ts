import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `DAC(b)`: out, ref, gnd, b inputs (RG p.395). */
export default {
  name: 'digital DAC',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['DAC'] } }],
  forms: [
    {
      terminals: [
        ...DIGITAL_SUPPLY,
        { name: 'out', side: 'right' },
        { name: 'ref', side: 'left' },
        { name: 'gnd', side: 'bottom' },
        { repeat: 'b', terminals: [{ name: 'in#', side: 'left' }] }
      ],
      nodesEnd: 'count',
      counts: { b: { argument: 0 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
