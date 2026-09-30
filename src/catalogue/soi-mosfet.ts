import type { ElementType } from './types';

/**
 * Silicon-on-insulator MOSFETs take four to seven nodes: BSIMSOI `d g s e [p] [b] [t]` (ngspice
 * M §7.7, Spectre `bsimsoi`, Xyce levels 10 and 70), SOI3 `d g s bg [b] [t]`. Drawn with the
 * four-terminal symbol; the back gate takes the symbol's `B` pin and the rest are not drawn.
 */
export default {
  name: 'SOI MOSFET',
  spellings: [
    { dialect: 'ngspice', letter: 'M', select: { by: 'model-type', types: ['b4soi', 'b3soipd', 'b3soifd', 'b3soidd', 'nsoi', 'psoi'] } },
    { dialect: 'xyce', letter: 'M', select: { by: 'model-type', types: ['nmos', 'pmos'], levels: [10, 70, 70450] } },
    { dialect: 'spectre', master: 'bsimsoi' }
  ],
  forms: [
    {
      terminals: [
        { name: 'D', side: 'top' },
        { name: 'G', side: 'left' },
        { name: 'S', side: 'bottom' },
        { name: 'B', side: 'right' },
        { name: 'P', side: 'right', optional: true },
        { name: 'body', side: 'right', optional: true },
        { name: 'T', side: 'right', optional: true }
      ],
      nodesEnd: 'model'
    }
  ],
  tail: 'model',
  draw: {
    symbol: {
      default: 'nmos',
      byModelType: { psoi: 'pmos', pmos: 'pmos' },
      byModelParameter: { type: { p: 'pmos' } },
      note: 'drawn as NMOS'
    }
  }
} satisfies ElementType;
