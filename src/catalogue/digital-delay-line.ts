import type { ElementType } from './types';
import { DIGITAL_SUPPLY } from './shared';

/** PSpice's `DLYLINE`: in, out (RG p.378). */
export default {
  name: 'digital delay line',
  spellings: [{ dialect: 'pspice', letter: 'U', select: { by: 'keyword', keywords: ['DLYLINE'] } }],
  forms: [{ terminals: [...DIGITAL_SUPPLY, { name: 'in', side: 'left' }, { name: 'out', side: 'right' }], nodesEnd: 'count' }],
  tail: 'model',
  draw: { block: { title: 'keyword-with-arguments' } }
} satisfies ElementType;
