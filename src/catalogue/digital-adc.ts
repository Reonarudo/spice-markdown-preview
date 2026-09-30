import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `ADC(b)`: in, ref, gnd, convert, status, over-range, b outputs (RG p.393). */
export default {
  name: 'digital ADC',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['ADC'] } }],
  forms: [
    {
      terminals: [
        ...DIGITAL_SUPPLY,
        { name: 'in', side: 'left' },
        { name: 'ref', side: 'left' },
        { name: 'gnd', side: 'bottom' },
        { name: 'convert', side: 'left' },
        { name: 'status', side: 'right' },
        { name: 'over', side: 'right' },
        { repeat: 'b', terminals: [{ name: 'out#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { b: { argument: 0 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
