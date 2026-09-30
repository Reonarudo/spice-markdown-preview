import type { ElementType } from './types';
import { everySpiceDialect } from './shared';

/**
 * `J d g s [b] model`: HSPICE and Spectre (`jfet (d g s [b])`) allow a fourth, bulk node. A block
 * until a JFET symbol exists; `njf`/`pjf` name the polarity in the title.
 */
export default {
  name: 'JFET',
  spellings: [...everySpiceDialect('J'), { dialect: 'spectre', master: 'jfet' }],
  forms: [
    {
      terminals: [
        { name: 'D', side: 'top' },
        { name: 'G', side: 'left' },
        { name: 'S', side: 'bottom' },
        { name: 'B', side: 'right', optional: true }
      ],
      nodesEnd: 'model'
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'JFET' }, polarity: { byModelType: { njf: 'N', pjf: 'P' } } } }
} satisfies ElementType;
