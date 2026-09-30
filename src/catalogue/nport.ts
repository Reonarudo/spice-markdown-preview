import type { ElementType } from './types';

/**
 * A linear n-port described by a file or model: HSPICE `S nd1 … ndN [ref…] MNAME=m|FQMODEL=m` (SI
 * p.29), Spectre `nport (t1 b1 [t2 b2 …]) file=`, Xyce `YLIN name t1 b1 … model`. HSPICE's pins are
 * numbered because a drawing cannot tell reference nodes from port nodes without the model.
 */
export default {
  name: 'n-port',
  spellings: [
    { dialect: 'hspice', letter: 'S' },
    { dialect: 'spectre', master: 'nport' },
    { dialect: 'xyce', letter: 'Y', select: { by: 'suffix', suffixes: ['LIN'] } }
  ],
  forms: [
    { dialects: ['hspice'], terminals: [], nodesEnd: 'all-positional' },
    {
      dialects: ['spectre'],
      terminals: [{ repeat: 'n', terminals: [{ name: 't#', side: 'left' }, { name: 'b#', side: 'left' }] }],
      nodesEnd: 'all-positional',
      counts: { n: 'solve' }
    },
    {
      dialects: ['xyce'],
      terminals: [{ repeat: 'n', terminals: [{ name: 't#', side: 'left' }, { name: 'b#', side: 'left' }] }],
      nodesEnd: 'last-positional',
      counts: { n: 'solve' }
    }
  ],
  tail: 'model',
  draw: { block: { title: { fixed: 'n-port' }, pins: 'numbered' } }
} satisfies ElementType;
