import type { ElementType } from './types';

/**
 * ngspice's XSPICE code model `A port … model`: the number and kind of ports come from the model's
 * interface, the last token is the model name, and ports may be vectors `[a b]`, typed `%vd(a b)`
 * pairs, inverted `~d`, or `null` (M §8.1.1). Pins are numbered by position (#1197).
 */
export default {
  name: 'code model',
  spellings: [{ dialect: 'ngspice', letter: 'A' }],
  forms: [{ terminals: [], nodesEnd: 'last-positional' }],
  tail: 'model',
  draw: { block: { title: 'model-type', pins: 'xspice-ports' } }
} satisfies ElementType;
