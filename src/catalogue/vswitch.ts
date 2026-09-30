import type { ElementType } from './types';
import { CONTROLLED_SOURCE } from './shared';

/**
 * The voltage-controlled switch `S n+ n- nc+ nc- model [on|off]`. Xyce also has the generic
 * `S n+ n- model CONTROL={expr}` with two nodes (RG §2.3.22). HSPICE's `S` is the S-parameter
 * n-port instead. Spectre `relay (1 2 ps ns)`.
 */
export default {
  name: 'voltage-controlled switch',
  spellings: [
    { dialect: 'ngspice', letter: 'S' },
    { dialect: 'ltspice', letter: 'S' },
    { dialect: 'pspice', letter: 'S' },
    { dialect: 'xyce', letter: 'S' },
    { dialect: 'spectre-spice', letter: 'S' },
    { dialect: 'spectre', master: 'relay' }
  ],
  forms: [
    { terminals: CONTROLLED_SOURCE, nodesEnd: 'count' },
    {
      match: { pair: ['CONTROL'] },
      dialects: ['xyce'],
      terminals: [{ name: 'n+', side: 'right' }, { name: 'n-', side: 'right' }],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'switch' } } }
} satisfies ElementType;
