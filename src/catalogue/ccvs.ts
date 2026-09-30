import type { ElementType } from './types';
import { PLUS_MINUS, everySpiceDialect, spectreMasters } from './shared';

/** `H n+ n- Vname transresistance`, two nodes in every form; Spectre `ccvs (p n)` with `probe=`, and `pccvs`. */
export default {
  name: 'CCVS',
  spellings: [...everySpiceDialect('H'), ...spectreMasters('ccvs', 'pccvs')],
  forms: [{ terminals: PLUS_MINUS, nodesEnd: 'count' }],
  tail: 'value',
  draw: { block: { title: { fixed: 'CCVS' } } }
} satisfies ElementType;
