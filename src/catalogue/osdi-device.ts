import type { ElementType } from './types';

/**
 * ngspice's Verilog-A device `N node … model [k=v …]`: the nodes follow the module's port list and
 * the model is the token before the first pair (M §9.3.1.5). Pins are numbered; the module name
 * titles the block.
 */
export default {
  name: 'Verilog-A device',
  spellings: [{ dialect: 'ngspice', letter: 'N' }],
  forms: [{ terminals: [], nodesEnd: 'last-positional' }],
  tail: 'model',
  draw: { block: { title: 'model-type', pins: 'numbered' } }
} satisfies ElementType;
