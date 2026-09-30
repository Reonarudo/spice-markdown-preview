import type { ElementType } from './types';
import { CONTROLLED_SOURCE, everySpiceDialect, spectreMasters } from './shared';

/**
 * The voltage-controlled current source: the same shapes as the VCVS with `CUR` for `VOL` and
 * PSpice's charge source `G … Q=`; HSPICE adds `VCR`, `VCCAP`, `NPWL`, `PPWL` (UG p.244–253).
 * ngspice's four-node `TABLE =` is E only. Spectre `vccs (sink src ps ns)` and `pvccs`.
 */
export default {
  name: 'VCCS',
  spellings: [...everySpiceDialect('G'), ...spectreMasters('vccs', 'pvccs')],
  forms: [
    { terminals: CONTROLLED_SOURCE, nodesEnd: 'count' },
    { match: { keyword: ['VCCS', 'VCR', 'VCCAP'] }, terminals: CONTROLLED_SOURCE, nodesEnd: 'count' },
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
      match: { keyword: ['VALUE', 'CUR', 'TABLE', 'LAPLACE', 'FREQ', 'CHEBYSHEV', 'NOISE'] },
      dialects: ['ngspice', 'ltspice', 'pspice', 'xyce', 'spectre-spice'],
      terminals: [{ name: 'n+', side: 'right' }, { name: 'n-', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { pair: ['VALUE', 'CUR', 'Q', 'NOISE'] },
      terminals: [{ name: 'n+', side: 'right' }, { name: 'n-', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['CUR', 'NOISE'] },
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
  draw: { block: { title: { fixed: 'VCCS' } } }
} satisfies ElementType;
