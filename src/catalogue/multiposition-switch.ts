import type { ElementType } from './types';

/** Spectre's ideal `switch (t0 t1 …)` with any number of positions (REF03 p.645). */
export default {
  name: 'multi-position switch',
  spellings: [{ dialect: 'spectre', master: 'switch' }],
  forms: [{ terminals: [], nodesEnd: 'all-positional' }],
  tail: 'none',
  draw: { block: { title: { fixed: 'switch' }, pins: 'numbered' } }
} satisfies ElementType;
