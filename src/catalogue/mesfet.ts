import type { ElementType } from './types';

/**
 * `Z d g s model` in ngspice, Xyce and Spectre's SPICE mode; LTspice's `Z` is a MESFET unless its
 * model is an IGBT; Spectre `gaas (d g s)`. PSpice's `Z` is always an IGBT and HSPICE has no `Z`.
 */
export default {
  name: 'MESFET',
  spellings: [
    { dialect: 'ngspice', letter: 'Z' },
    { dialect: 'ltspice', letter: 'Z' },
    { dialect: 'xyce', letter: 'Z' },
    { dialect: 'spectre-spice', letter: 'Z' },
    { dialect: 'spectre', master: 'gaas' }
  ],
  forms: [
    {
      terminals: [
        { name: 'D', side: 'top' },
        { name: 'G', side: 'left' },
        { name: 'S', side: 'bottom' }
      ],
      nodesEnd: 'model'
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'MESFET' }, polarity: { byModelType: { nmf: 'N', pmf: 'P', nhfet: 'N', phfet: 'P' } } } }
} satisfies ElementType;
