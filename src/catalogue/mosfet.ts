import type { ElementType } from './types';
import { everySpiceDialect, spectreMasters } from './shared';

/**
 * The four-terminal bulk MOSFET, `M d g s b model`. HSPICE lets the bulk be left off (taken from the
 * model's `BULK=`), so the nodes end where the model begins. The fallback for `M`: VDMOS and SOI
 * models select their own types. Spectre's bulk MOS masters spell it by name; PSP, BSIM-CMG,
 * BSIM6 and HiSIM2 are listed on the strength of their family, their terminal order being
 * unconfirmed in the public references.
 */
export default {
  name: 'MOSFET',
  spellings: [
    ...everySpiceDialect('M'),
    ...spectreMasters('mos1', 'mos2', 'mos3', 'bsim1', 'bsim2', 'bsim3', 'bsim3v3', 'bsim4', 'ekv', 'hisim', 'hisim2', 'psp102', 'psp103', 'bsimcmg', 'bsim6')
  ],
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
  draw: {
    symbol: {
      default: 'nmos',
      byModelType: { pmos: 'pmos' },
      byModelParameter: { type: { p: 'pmos' } },
      note: 'drawn as NMOS'
    }
  }
} satisfies ElementType;
