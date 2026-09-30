/**
 * Per-dialect node rules: which spellings are ground, which nodes are global, whether case
 * matters, and which element letters the dialect has. Directives are not catalogued; they belong to
 * the base grammars and their overlays.
 *
 * Sources: the dialect research on the `research/<dialect>` branches (ngspice-47 manual and source,
 * LTspice 26.1 help, PSpice A/D 16.6 reference, HSPICE B-2008.09 manuals, Xyce 7.10 reference and
 * source, Spectre 5.1/19.1 manuals).
 */
import type { DialectId } from './types';

export interface Dialect {
  id: DialectId;
  /** Not an accepted `dialect` value; entered only by `simulator lang=spice` inside a Spectre fence. */
  internal?: true;
  /** Spellings of the ground node, compared case-insensitively unless `caseSensitive`. */
  ground: readonly string[];
  /** Xyce: these are ground only when the netlist says `.PREPROCESS REPLACEGROUND TRUE`. */
  groundWhenReplaceGround?: readonly string[];
  /** Spectre: the first name on a `global` statement is ground too. */
  groundFromGlobal?: true;
  /** Regular expressions (source text) a node name matches when it is global by its spelling alone. */
  globalNodePatterns: readonly string[];
  /** Whether a `.global` (SPICE) or `global` (Spectre) statement also makes nodes global. */
  globalStatement: boolean;
  /** Whether node, model and subcircuit names keep their case. */
  caseSensitive: boolean;
  /** The element letters the dialect accepts. Empty for native Spectre, which spells by master. */
  letters: readonly string[];
  /** Spectre: masters that make a statement an analysis or control, not an element — skipped. */
  skipMasters?: readonly string[];
}

const SPICE3_LETTERS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'O', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Z'];

export const DIALECTS: Readonly<Record<DialectId, Dialect>> = {
  ngspice: {
    id: 'ngspice',
    ground: ['0', 'gnd'],
    globalNodePatterns: [],
    globalStatement: true,
    caseSensitive: false,
    letters: [...SPICE3_LETTERS, 'A', 'N', 'P', 'Y']
  },
  ltspice: {
    id: 'ltspice',
    ground: ['0', 'gnd'],
    globalNodePatterns: ['^\\$G_'],
    globalStatement: true,
    caseSensitive: false,
    letters: [...SPICE3_LETTERS, 'A', '@', '&']
  },
  pspice: {
    id: 'pspice',
    // PSpice documents only `0`; `gnd` is kept as ground for continuity with today's reader (unconfirmed).
    ground: ['0', 'gnd'],
    // `$D_HI`, `$D_LO` and `$D_NC` are treated as global nodes until their meaning is confirmed (#1197).
    globalNodePatterns: ['^\\$G_', '^\\$D_'],
    globalStatement: false,
    caseSensitive: false,
    letters: [...SPICE3_LETTERS, 'N']
  },
  hspice: {
    id: 'hspice',
    ground: ['0', 'gnd', 'gnd!', 'ground', '!gnd'],
    globalNodePatterns: [],
    globalStatement: true,
    caseSensitive: false,
    letters: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X']
  },
  xyce: {
    id: 'xyce',
    ground: ['0'],
    groundWhenReplaceGround: ['gnd', 'gnd!', 'ground'],
    globalNodePatterns: ['^\\$G'],
    globalStatement: true,
    caseSensitive: false,
    letters: [...SPICE3_LETTERS, 'P', 'Y']
  },
  spectre: {
    id: 'spectre',
    ground: ['0'],
    groundFromGlobal: true,
    globalNodePatterns: [],
    globalStatement: true,
    caseSensitive: true,
    letters: [],
    skipMasters: [
      // Analyses: shaped like instances, told apart only by the master.
      'ac', 'acmatch', 'dc', 'dcmatch', 'envlp', 'hb', 'hbac', 'hbnoise', 'hbsp', 'hbstb', 'hbxf', 'lf', 'loadpull',
      'montecarlo', 'noise', 'pac', 'pdisto', 'pnoise', 'psp', 'pss', 'pstb', 'pxf', 'pz', 'qpac', 'qpnoise', 'qpsp',
      'qpss', 'qpxf', 'reliability', 'sp', 'stb', 'stress', 'sweep', 'tdr', 'thermal', 'tran', 'xf',
      // Control statements.
      'alter', 'altergroup', 'check', 'checklimit', 'cosim', 'info', 'options', 'set', 'shell', 'uti', 'fourier',
      'paramtest', 'assert', 'paramset'
    ]
  },
  'spectre-spice': {
    id: 'spectre-spice',
    internal: true,
    ground: ['0'],
    groundFromGlobal: true,
    globalNodePatterns: [],
    globalStatement: true,
    caseSensitive: false,
    letters: SPICE3_LETTERS
  }
};

/** The dialects a fence may name, in the order the setting lists them. */
export const PUBLIC_DIALECTS: readonly DialectId[] = ['ngspice', 'ltspice', 'pspice', 'hspice', 'xyce', 'spectre'];
