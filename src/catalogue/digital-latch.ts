import type { ElementType, Terminal } from './types';
import { DIGITAL_SUPPLY } from './shared';

const PRESET: Terminal = { name: 'PRE', side: 'left' };
const CLEAR: Terminal = { name: 'CLR', side: 'left' };
const GATE: Terminal = { name: 'G', side: 'left' };

/**
 * Gated latches: PSpice `SRFF(g)` s×g r×g q×g qbar×g and `DLTCH(g)` d×g q×g qbar×g sharing preset,
 * clear and gate (RG p.374); Xyce's single `DLTCH` with enable (RG §2.3.28).
 */
export default {
  name: 'digital latch',
  spellings: [
    { dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['SRFF', 'DLTCH'] } },
    { dialect: 'xyce', letter: 'U', select: { by: 'keyword', keywords: ['DLTCH'] } }
  ],
  forms: [
    {
      match: { keyword: ['SRFF'] },
      terminals: [
        ...DIGITAL_SUPPLY, PRESET, CLEAR, GATE,
        { repeat: 'g', terminals: [{ name: 'S#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'R#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'Q#', side: 'right' }] },
        { repeat: 'g', terminals: [{ name: 'Q̅#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['DLTCH'] },
      dialects: ['pspice'],
      terminals: [
        ...DIGITAL_SUPPLY, PRESET, CLEAR, GATE,
        { repeat: 'g', terminals: [{ name: 'D#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'Q#', side: 'right' }] },
        { repeat: 'g', terminals: [{ name: 'Q̅#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['DLTCH'] },
      dialects: ['xyce'],
      terminals: [...DIGITAL_SUPPLY, PRESET, CLEAR, { name: 'EN', side: 'left' }, { name: 'D', side: 'left' }, { name: 'Q', side: 'right' }, { name: 'Q̅', side: 'right' }],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
