import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/**
 * A single digital gate: PSpice `U name TYPE[(n)] dpwr dgnd in… out timing io` (RG p.358–359) and
 * Xyce `U name TYPE[(n)] dpwr dgnd in… out model` (RG §2.3.28). `AND`, `NAND`, `OR` and `NOR`
 * take `(n)` inputs; the rest have fixed pins. The title is the type with its parentheses.
 */
export default {
  name: 'digital gate',
  spellings: [
    { dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['BUF', 'INV', 'AND', 'NAND', 'OR', 'NOR', 'XOR', 'NXOR'] } },
    { dialect: 'xyce', letter: 'U', select: { by: 'keyword', keywords: ['BUF', 'INV', 'NOT', 'AND', 'NAND', 'OR', 'NOR', 'XOR', 'NXOR'] } }
  ],
  forms: [
    {
      match: { keyword: ['BUF', 'INV', 'NOT'] },
      terminals: [...DIGITAL_SUPPLY, { name: 'in', side: 'left' }, { name: 'out', side: 'right' }],
      nodesEnd: 'count'
    },
    {
      match: { keyword: ['AND', 'NAND', 'OR', 'NOR'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: 'n', terminals: [{ name: 'in#', side: 'left' }] }, { name: 'out', side: 'right' }],
      nodesEnd: 'count',
      counts: { n: { argument: 0 } }
    },
    {
      match: { keyword: ['XOR', 'NXOR'] },
      terminals: [...DIGITAL_SUPPLY, { name: 'in1', side: 'left' }, { name: 'in2', side: 'left' }, { name: 'out', side: 'right' }],
      nodesEnd: 'count'
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
