import type { ElementType } from './types';

/** Spectre's multiconductor line `mtline`, with as many terminals as the line has conductors (REF03 p.576). */
export default {
  name: 'multiconductor line',
  spellings: [{ dialect: 'spectre', master: 'mtline' }],
  forms: [{ terminals: [], nodesEnd: 'all-positional' }],
  tail: 'none',
  draw: { block: { title: { fixed: 'coupled line' }, pins: 'numbered' } }
} satisfies ElementType;
