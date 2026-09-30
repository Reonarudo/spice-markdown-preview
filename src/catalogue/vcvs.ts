import type { ElementType } from './types';
import { CONTROLLED_SOURCE, everySpiceDialect, spectreMasters } from './shared';

/**
 * The voltage-controlled voltage source has more shapes than any other element. The token after
 * the two output nodes decides:
 * - a node: the linear `E n+ n- nc+ nc- gain` (every dialect), also after a `VCVS` keyword;
 * - `POLY(n)`: 2n controlling nodes (bare `POLY` is `POLY(1)` in HSPICE); ngspice and HSPICE
 *   gates `AND(n)`, `OR(n)`, `NAND(n)`, `NOR(n)` likewise;
 * - an expression keyword — `VALUE`, `VOL`, `TABLE`, `LAPLACE`, `FREQ`, `CHEBYSHEV`, `NOISE` — or a
 *   `value=`/`vol=`/`F=` pair: two nodes only (ngspice M §5.2, PSpice RG p.165–176, LTspice, Xyce);
 * - in HSPICE the keyword forms keep four nodes with the keyword between the pairs (UG p.226–240),
 *   and only `VOL=` and `NOISE=` are two-node.
 * Spectre `vcvs (p n ps ns)` and the polynomial `pvcvs`.
 */
export default {
  name: 'VCVS',
  spellings: [...everySpiceDialect('E'), ...spectreMasters('vcvs', 'pvcvs')],
  forms: [
    { terminals: CONTROLLED_SOURCE, nodesEnd: 'count' },
    { match: { keyword: ['VCVS'] }, terminals: CONTROLLED_SOURCE, nodesEnd: 'count' },
    {
      match: { keyword: ['POLY', 'AND', 'NAND', 'OR', 'NOR'] },
      terminals: [
        { name: 'n+', side: 'right' },
        { name: 'n-', side: 'right' },
        { repeat: 'n', terminals: [{ name: 'nc#+', side: 'left' }, { name: 'nc#-', side: 'left' }] }
      ],
      nodesEnd: 'count',
      counts: { n: { argument: 0, default: 1 } }
    },
    {
      match: { keyword: ['VALUE', 'VOL', 'TABLE', 'LAPLACE', 'FREQ', 'CHEBYSHEV', 'NOISE'] },
      dialects: ['ngspice', 'ltspice', 'pspice', 'xyce', 'spectre-spice'],
      terminals: [{ name: 'n+', side: 'right' }, { name: 'n-', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { pair: ['VALUE', 'VOL', 'F', 'NOISE'] },
      terminals: [{ name: 'n+', side: 'right' }, { name: 'n-', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['VOL', 'NOISE'] },
      dialects: ['hspice'],
      terminals: [{ name: 'n+', side: 'right' }, { name: 'n-', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['LAPLACE', 'DELAY', 'POLE', 'FREQ', 'FOSTER', 'OPAMP', 'TRANSFORMER', 'PWL', 'NPWL', 'PPWL'] },
      dialects: ['hspice'],
      terminals: CONTROLLED_SOURCE,
      nodesEnd: 'count'
    }
  ],
  tail: 'value',
  draw: { block: { title: { fixed: 'VCVS' } } }
} satisfies ElementType;
