import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's tristate gates (RG p.360–361): as the gates and arrays, with one enable before the outputs. */
export default {
  name: 'digital tristate gate',
  spellings: [
    {
      dialect: 'pspice',
      letter: 'U',
      select: {
        by: 'keyword',
        keywords: ['BUF3', 'INV3', 'AND3', 'NAND3', 'OR3', 'NOR3', 'XOR3', 'NXOR3', 'BUF3A', 'INV3A', 'XOR3A', 'NXOR3A', 'AND3A', 'NAND3A', 'OR3A', 'NOR3A']
      }
    }
  ],
  forms: [
    {
      match: { keyword: ['BUF3', 'INV3'] },
      terminals: [...DIGITAL_SUPPLY, { name: 'in', side: 'left' }, { name: 'en', side: 'left' }, { name: 'out', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['AND3', 'NAND3', 'OR3', 'NOR3'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: 'n', terminals: [{ name: 'in#', side: 'left' }] }, { name: 'en', side: 'left' }, { name: 'out', side: 'right' }],
      nodesEnd: 'count',
      counts: { n: { argument: 0 } }
    },
    {
      match: { keyword: ['XOR3', 'NXOR3'] },
      terminals: [...DIGITAL_SUPPLY, { name: 'in1', side: 'left' }, { name: 'in2', side: 'left' }, { name: 'en', side: 'left' }, { name: 'out', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['BUF3A', 'INV3A'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: 'g', terminals: [{ name: 'in#', side: 'left' }] }, { name: 'en', side: 'left' }, { repeat: 'g', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['XOR3A', 'NXOR3A'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: '2*g', terminals: [{ name: 'in#', side: 'left' }] }, { name: 'en', side: 'left' }, { repeat: 'g', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['AND3A', 'NAND3A', 'OR3A', 'NOR3A'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: 'n*g', terminals: [{ name: 'in#', side: 'left' }] }, { name: 'en', side: 'left' }, { repeat: 'g', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { n: { argument: 0 }, g: { argument: 1 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
