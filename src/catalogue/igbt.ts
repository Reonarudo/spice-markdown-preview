import type { ElementType } from './types';

/**
 * The insulated-gate bipolar transistor, `Z c g e model`: PSpice's only `Z` (model `NIGBT`), and
 * LTspice's `Z` when its model is `NIGBT` or `PIGBT` (else a MESFET).
 */
export default {
  name: 'IGBT',
  spellings: [
    { dialect: 'pspice', letter: 'Z' },
    { dialect: 'ltspice', letter: 'Z', select: { by: 'model-type', types: ['nigbt', 'pigbt'] } }
  ],
  forms: [
    {
      terminals: [
        { name: 'C', side: 'top' },
        { name: 'G', side: 'left' },
        { name: 'E', side: 'bottom' }
      ],
      nodesEnd: 'model'
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'IGBT' }, polarity: { byModelType: { nigbt: 'N', pigbt: 'P' } } } }
} satisfies ElementType;
