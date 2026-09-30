import type { ElementType, Terminal } from './types';
import { DIGITAL_SUPPLY } from './shared';

const PRESET: Terminal = { name: 'PRE', side: 'left' };
const CLEAR: Terminal = { name: 'CLR', side: 'left' };
const CLOCK: Terminal = { name: 'CLK', side: 'left' };

/**
 * Edge-triggered flip-flops. PSpice's take `(g)` flip-flops sharing preset, clear and clock:
 * `DFF(g)` d×g q×g qbar×g, `JKFF(g)` j×g k×g q×g qbar×g, and `DFFDE`/`JKFFDE` with positive- and
 * negative-edge enables (RG p.368). Xyce's `DFF`, `JKFF` and `TFF` are single (RG §2.3.28).
 */
export default {
  name: 'digital flip-flop',
  spellings: [
    { dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['DFF', 'JKFF', 'DFFDE', 'JKFFDE'] } },
    { dialect: 'xyce', letter: 'U', select: { by: 'keyword', keywords: ['DFF', 'JKFF', 'TFF'] } }
  ],
  forms: [
    {
      match: { keyword: ['DFF'] },
      dialects: ['pspice'],
      terminals: [
        ...DIGITAL_SUPPLY, PRESET, CLEAR, CLOCK,
        { repeat: 'g', terminals: [{ name: 'D#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'Q#', side: 'right' }] },
        { repeat: 'g', terminals: [{ name: 'Q̅#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['JKFF'] },
      dialects: ['pspice'],
      terminals: [
        ...DIGITAL_SUPPLY, PRESET, CLEAR, { name: 'CLK̅', side: 'left' },
        { repeat: 'g', terminals: [{ name: 'J#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'K#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'Q#', side: 'right' }] },
        { repeat: 'g', terminals: [{ name: 'Q̅#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['DFFDE'] },
      terminals: [
        ...DIGITAL_SUPPLY, PRESET, CLEAR, CLOCK, { name: 'PE', side: 'left' }, { name: 'NE', side: 'left' },
        { repeat: 'g', terminals: [{ name: 'D#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'Q#', side: 'right' }] },
        { repeat: 'g', terminals: [{ name: 'Q̅#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['JKFFDE'] },
      terminals: [
        ...DIGITAL_SUPPLY, PRESET, CLEAR, CLOCK, { name: 'PE', side: 'left' }, { name: 'NE', side: 'left' },
        { repeat: 'g', terminals: [{ name: 'J#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'K#', side: 'left' }] },
        { repeat: 'g', terminals: [{ name: 'Q#', side: 'right' }] },
        { repeat: 'g', terminals: [{ name: 'Q̅#', side: 'right' }] }
      ],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['DFF'] },
      dialects: ['xyce'],
      terminals: [...DIGITAL_SUPPLY, PRESET, CLEAR, CLOCK, { name: 'D', side: 'left' }, { name: 'Q', side: 'right' }, { name: 'Q̅', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['JKFF'] },
      dialects: ['xyce'],
      terminals: [...DIGITAL_SUPPLY, PRESET, CLEAR, CLOCK, { name: 'J', side: 'left' }, { name: 'K', side: 'left' }, { name: 'Q', side: 'right' }, { name: 'Q̅', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['TFF'] },
      terminals: [...DIGITAL_SUPPLY, { name: 'T', side: 'left' }, CLOCK, { name: 'Q', side: 'right' }, { name: 'Q̅', side: 'right' }],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
