import type { ElementType } from './types';

/** PSpice's analog-to-digital interface `O interface reference model DGTLNET=net iomodel` (RG p.439–441). */
export default {
  name: 'digital output',
  spellings: [{ dialect: 'pspice', letter: 'O' }],
  forms: [{ terminals: [{ name: 'in', side: 'left' }, { name: 'ref', side: 'left' }], nodesEnd: 'count' }],
  tail: 'model',
  draw: { block: { title: { fixed: 'digital output' } } }
} satisfies ElementType;
