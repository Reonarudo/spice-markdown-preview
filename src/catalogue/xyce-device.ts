import type { ElementType } from './types';

/**
 * Any other Xyce `Y<type> name nodes… [model] [params]` device — accelerated mass, power-grid
 * branches, op-amp, battery, neuron models, the deprecated `Y` digital gates — drawn as a block
 * titled with the type and numbered pins (#1188). Undocumented types have no positional model, so
 * every positional token is a node.
 */
export default {
  name: 'Xyce device',
  spellings: [{ dialect: 'xyce', letter: 'Y' }],
  forms: [{ terminals: [], nodesEnd: 'all-positional' }],
  tail: 'none',
  draw: { block: { title: 'suffix', pins: 'numbered' } }
} satisfies ElementType;
