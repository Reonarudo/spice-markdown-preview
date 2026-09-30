/** Terminal lists several element types share. Data only, spread into entries. */
import type { Spelling, Terminal } from './types';

/** `n+ n-` of a two-terminal source or behavioural element. */
export const PLUS_MINUS: readonly Terminal[] = [
  { name: '+', side: 'top' },
  { name: '-', side: 'bottom' }
];

/** The two ends of a passive, as the resistor, capacitor and inductor symbols name them. */
export const A_B: readonly Terminal[] = [
  { name: 'A', side: 'top' },
  { name: 'B', side: 'bottom' }
];

/** A dependent source's output pair, then its controlling pair. */
export const CONTROLLED_SOURCE: readonly Terminal[] = [
  { name: 'n+', side: 'right' },
  { name: 'n-', side: 'right' },
  { name: 'nc+', side: 'left' },
  { name: 'nc-', side: 'left' }
];

/** Both ends of a transmission line: port A on the left, port B on the right. */
export const LINE_PORTS: readonly Terminal[] = [
  { name: 'A+', side: 'left' },
  { name: 'A-', side: 'left' },
  { name: 'B+', side: 'right' },
  { name: 'B-', side: 'right' }
];

/** The digital power and ground pins every PSpice and Xyce `U` primitive starts with. */
export const DIGITAL_SUPPLY: readonly Terminal[] = [
  { name: 'DPWR', side: 'top' },
  { name: 'DGND', side: 'bottom' }
];

/** Several Spectre masters for one element type. */
export function spectreMasters(...masters: string[]): readonly Spelling[] {
  return masters.map((master) => ({ dialect: 'spectre', master }));
}

/** A letter every SPICE dialect spells the same way, Spectre's SPICE mode included. */
export function everySpiceDialect(letter: string): readonly Spelling[] {
  return [
    { dialect: 'ngspice', letter },
    { dialect: 'ltspice', letter },
    { dialect: 'pspice', letter },
    { dialect: 'hspice', letter },
    { dialect: 'xyce', letter },
    { dialect: 'spectre-spice', letter }
  ];
}
