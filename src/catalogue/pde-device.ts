import type { ElementType } from './types';

/** Xyce's TCAD device `YPDE name n1 n2 [n3 n4 …] model [params]`, two to a hundred nodes (RG §2.4). */
export default {
  name: 'PDE device',
  spellings: [{ dialect: 'xyce', letter: 'Y', select: { by: 'suffix', suffixes: ['PDE'] } }],
  forms: [{ terminals: [], nodesEnd: 'last-positional' }],
  tail: 'model',
  draw: { block: { title: 'suffix', pins: 'numbered' } }
} satisfies ElementType;
