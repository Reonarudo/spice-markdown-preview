import type { ElementType } from './types';

/**
 * LTspice's special function `A 1 2 3 4 5 6 7 8 KEYWORD …`: always eight terminals, inputs 1–5,
 * complementary outputs 6 and 7, common 8; a pin tied to 8 is unused and not drawn (#1197). The
 * keyword (`INV BUF AND OR XOR SCHMITT SCHMTBUF SCHMTINV DFLOP VARISTOR MODULATE OTA …`) titles it.
 */
export default {
  name: 'special function',
  spellings: [{ dialect: 'ltspice', letter: 'A' }],
  forms: [
    {
      terminals: [
        { name: '1', side: 'left' },
        { name: '2', side: 'left' },
        { name: '3', side: 'left' },
        { name: '4', side: 'left' },
        { name: '5', side: 'left' },
        { name: '6', side: 'right' },
        { name: '7', side: 'right' },
        { name: '8', side: 'bottom' }
      ],
      nodesEnd: 'count'
    }
  ],
  tail: 'none',
  draw: { block: { title: 'keyword', pins: 'hide-tied-to-common' } }
} satisfies ElementType;
