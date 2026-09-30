import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `RAM(a,d)`: read enable, write enable, a address lines, d write-data and d read-data lines (RG p.388). */
export default {
  name: 'digital RAM',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['RAM'] } }],
  forms: [
    {
      terminals: [
        ...DIGITAL_SUPPLY,
        { name: 'RE', side: 'left' },
        { name: 'WE', side: 'left' },
        { repeat: 'a', terminals: [{ name: 'A#', side: 'left' }] },
        { repeat: 'd', terminals: [{ name: 'WD#', side: 'left' }] },
        { repeat: 'd', terminals: [{ name: 'RD#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { a: { argument: 0 }, d: { argument: 1 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
