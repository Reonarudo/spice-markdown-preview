import type { ElementType } from './types';
import { PLUS_MINUS, everySpiceDialect, spectreMasters } from './shared';

/**
 * `F n+ n- Vname gain`: the controlling source is a name, not a node, so every form has two nodes
 * (`POLY(n)`, `value=`, HSPICE `PWL(1)`, `AND(k)`, `DELAY` included). Spectre `cccs (sink src)`
 * with `probe=`, and `pcccs`.
 */
export default {
  name: 'CCCS',
  spellings: [...everySpiceDialect('F'), ...spectreMasters('cccs', 'pcccs')],
  forms: [{ terminals: PLUS_MINUS, nodesEnd: 'count' }],
  tail: 'value',
  draw: { block: { title: { fixed: 'CCCS' } } }
} satisfies ElementType;
