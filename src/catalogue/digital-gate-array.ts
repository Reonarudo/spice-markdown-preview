import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/**
 * PSpice's gate arrays and compound gates (RG p.356–359): `BUFA(g)`/`INVA(g)` have g inputs and g
 * outputs; `XORA(g)`/`NXORA(g)` 2g inputs and g outputs; `ANDA(n,g)` and kin n·g inputs and g
 * outputs; `AO(n,g)`, `OA`, `AOI`, `OAI` n·g inputs into one output.
 */
export default {
  name: 'digital gate array',
  spellings: [
    {
      dialect: 'pspice',
      letter: 'U',
      select: { by: 'keyword', keywords: ['BUFA', 'INVA', 'XORA', 'NXORA', 'ANDA', 'NANDA', 'ORA', 'NORA', 'AO', 'OA', 'AOI', 'OAI'] }
    }
  ],
  forms: [
    {
      match: { keyword: ['BUFA', 'INVA'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: 'g', terminals: [{ name: 'in#', side: 'left' }] }, { repeat: 'g', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['XORA', 'NXORA'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: '2*g', terminals: [{ name: 'in#', side: 'left' }] }, { repeat: 'g', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { g: { argument: 0 } }
    },
    {
      match: { keyword: ['ANDA', 'NANDA', 'ORA', 'NORA'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: 'n*g', terminals: [{ name: 'in#', side: 'left' }] }, { repeat: 'g', terminals: [{ name: 'out#', side: 'right' }] }],
      nodesEnd: 'count',
      counts: { n: { argument: 0 }, g: { argument: 1 } }
    },
    {
      match: { keyword: ['AO', 'OA', 'AOI', 'OAI'] },
      terminals: [...DIGITAL_SUPPLY, { repeat: 'n*g', terminals: [{ name: 'in#', side: 'left' }] }, { name: 'out', side: 'right' }],
      nodesEnd: 'count',
      counts: { n: { argument: 0 }, g: { argument: 1 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
