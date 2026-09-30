import type { ElementType, Terminal } from './types';

const PU: Terminal = { name: 'nd_pu', side: 'top' };
const PD: Terminal = { name: 'nd_pd', side: 'bottom' };
const OUT: Terminal = { name: 'nd_out', side: 'right' };
const IN: Terminal = { name: 'nd_in', side: 'left' };
const EN: Terminal = { name: 'nd_en', side: 'left' };
const OUT_OF_IN: Terminal = { name: 'nd_out_of_in', side: 'right' };
/** The power- and ground-clamp pins: written first on input buffers, optionally last on the others. */
const PC: Terminal = { name: 'nd_pc', side: 'top' };
const GC: Terminal = { name: 'nd_gc', side: 'bottom' };
const PC_OPTIONAL: Terminal = { ...PC, optional: true };
const GC_OPTIONAL: Terminal = { ...GC, optional: true };

/**
 * HSPICE's IBIS I/O buffer `B node … file='f.ibs' model='m' [buffer=n]`: the nodes end at the
 * first pair, and their names are known only when `buffer=` names the type (SI Table 20). The
 * supply pins `nd_pu nd_pd nd_pc nd_gc` sit on the top and bottom edges (#1197).
 */
export default {
  name: 'IBIS buffer',
  spellings: [{ dialect: 'hspice', letter: 'B' }],
  forms: [
    { terminals: [], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['1', '11'] }, terminals: [PC, GC, IN, OUT_OF_IN], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['2', '5', '7', '9'] }, terminals: [PU, PD, OUT, IN, PC_OPTIONAL, GC_OPTIONAL], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['3', '6', '8', '10'] }, terminals: [PU, PD, OUT, IN, EN, OUT_OF_IN, PC_OPTIONAL, GC_OPTIONAL], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['4'] }, terminals: [PU, PD, OUT, IN, EN, PC_OPTIONAL, GC_OPTIONAL], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['12'] }, terminals: [PU, OUT, IN, PC_OPTIONAL, GC_OPTIONAL], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['13'] }, terminals: [PU, OUT, IN, EN, OUT_OF_IN, PC_OPTIONAL, GC_OPTIONAL], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['14'] }, terminals: [PU, OUT, IN, EN, PC_OPTIONAL, GC_OPTIONAL], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['15', '16'] }, terminals: [IN, OUT], nodesEnd: 'all-positional' },
    { match: { pair: ['buffer'], values: ['17'] }, terminals: [PC, GC, OUT], nodesEnd: 'all-positional' }
  ],
  tail: 'none',
  draw: { block: { title: { fixed: 'IBIS buffer' }, pins: 'numbered' } }
} satisfies ElementType;
