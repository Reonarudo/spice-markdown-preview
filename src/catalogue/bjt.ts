import type { ElementType } from './types';
import { everySpiceDialect } from './shared';

/**
 * `Q c b e [s] [tj] model`: the substrate and, for VBIC and HICUM, a thermal node are optional, so
 * the nodes end at the first token naming a defined model (ngspice M §7.3.1; Xyce writes a named
 * substrate as `[SUB]`). Spectre `bjt (c b e [s])` and `vbic (c b e [s] [dt] [tl])`. NPN unless the
 * model says otherwise: `pnp`, PSpice's lateral `lpnp`, Spectre `type=pnp`.
 */
export default {
  name: 'bipolar transistor',
  spellings: [...everySpiceDialect('Q'), { dialect: 'spectre', master: 'bjt' }, { dialect: 'spectre', master: 'vbic' }],
  forms: [
    {
      terminals: [
        { name: 'C', side: 'top' },
        { name: 'B', side: 'left' },
        { name: 'E', side: 'bottom' },
        { name: 'S', side: 'right', optional: true },
        { name: 'tj', side: 'right', optional: true },
        { name: 'tl', side: 'right', optional: true }
      ],
      nodesEnd: 'model'
    }
  ],
  tail: 'model',
  draw: {
    symbol: {
      default: 'npn',
      byModelType: { pnp: 'pnp', lpnp: 'pnp' },
      byModelParameter: { type: { pnp: 'pnp' } },
      note: 'drawn as NPN'
    }
  }
} satisfies ElementType;
