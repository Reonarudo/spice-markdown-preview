import type { ElementType } from './types';
import { PLUS_MINUS } from './shared';

/**
 * A two-node port for S-parameter analysis: HSPICE `P p n port=k …` (UG p.184), Xyce `P n+ n- port=k`
 * (RG §2.3.11), Spectre `port (p n) num=`. ngspice's `P` is the coupled line.
 */
export default {
  name: 'port',
  spellings: [
    { dialect: 'hspice', letter: 'P' },
    { dialect: 'xyce', letter: 'P' },
    { dialect: 'spectre', master: 'port' }
  ],
  forms: [{ terminals: PLUS_MINUS, nodesEnd: 'count' }],
  tail: 'value',
  draw: { block: { title: { fixed: 'port' } } }
} satisfies ElementType;
