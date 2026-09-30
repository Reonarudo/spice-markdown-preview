import type { ElementType } from './types';

/**
 * The vertical double-diffused power MOSFET has three terminals, `M d g s model`, plus two
 * thermal nodes `tj tc` with the `thermal` flag in ngspice (M §7.7). LTspice writes its model
 * `VDMOS(… pchan)`, ngspice `vdmos pchan` or `vdmosp`; Xyce uses NMOS/PMOS level 18. Drawn with
 * the three-pin symbol, P-channel when the model says so (#1197).
 */
export default {
  name: 'VDMOS',
  spellings: [
    { dialect: 'ngspice', letter: 'M', select: { by: 'model-type', types: ['vdmos', 'vdmosn', 'vdmosp'] } },
    { dialect: 'ltspice', letter: 'M', select: { by: 'model-type', types: ['vdmos'] } },
    { dialect: 'xyce', letter: 'M', select: { by: 'model-type', types: ['nmos', 'pmos'], levels: [18] } }
  ],
  forms: [
    {
      terminals: [
        { name: 'D', side: 'top' },
        { name: 'G', side: 'left' },
        { name: 'S', side: 'bottom' },
        { name: 'tj', side: 'right', optional: true },
        { name: 'tc', side: 'right', optional: true }
      ],
      nodesEnd: 'model'
    }
  ],
  tail: 'model',
  draw: {
    symbol: {
      default: 'nmos3',
      byModelType: { vdmosp: 'pmos3', pmos: 'pmos3' },
      byModelFlag: { pchan: 'pmos3' },
      note: 'drawn as N-channel'
    }
  }
} satisfies ElementType;
