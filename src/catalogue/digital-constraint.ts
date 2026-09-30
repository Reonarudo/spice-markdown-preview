import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `CONSTRAINT(i)` timing checker: i inputs, no outputs, only an I/O model (RG p.409). */
export default {
  name: 'digital constraint',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['CONSTRAINT'] } }],
  forms: [
    {
      terminals: [...DIGITAL_SUPPLY, { repeat: 'i', terminals: [{ name: 'in#', side: 'left' }] }],
      nodesEnd: 'count',
      counts: { i: { argument: 0 } }
    }
  ],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
