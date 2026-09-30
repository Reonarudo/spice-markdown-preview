/**
 * The element catalogue (ADR 0007): every element type, keyed by its id — the file name — and the
 * lookup from a dialect's spelling to the type it names.
 */
import type { DialectId, ElementType, Select, Spelling } from './types';
import ammeter from './ammeter';
import behaviouralSource from './behavioural-source';
import bjt from './bjt';
import capacitor from './capacitor';
import cccs from './cccs';
import ccvs from './ccvs';
import coupledLossyLine from './coupled-lossy-line';
import cplLine from './cpl-line';
import digitalAdc from './digital-adc';
import digitalAdder from './digital-adder';
import digitalConstraint from './digital-constraint';
import digitalDac from './digital-dac';
import digitalDelayLine from './digital-delay-line';
import digitalFlipFlop from './digital-flip-flop';
import digitalGate from './digital-gate';
import digitalGateArray from './digital-gate-array';
import digitalInput from './digital-input';
import digitalLatch from './digital-latch';
import digitalLogicExpression from './digital-logic-expression';
import digitalOutput from './digital-output';
import digitalPinDelay from './digital-pin-delay';
import digitalPld from './digital-pld';
import digitalPull from './digital-pull';
import digitalRam from './digital-ram';
import digitalRom from './digital-rom';
import digitalStimulus from './digital-stimulus';
import digitalTransferGate from './digital-transfer-gate';
import digitalTristateGate from './digital-tristate-gate';
import diode from './diode';
import fra from './fra';
import fraProbe from './fra-probe';
import gaasfet from './gaasfet';
import ibisBuffer from './ibis-buffer';
import idealDelay from './ideal-delay';
import igbt from './igbt';
import inductor from './inductor';
import isource from './isource';
import iswitch from './iswitch';
import jfet from './jfet';
import losslessLine from './lossless-line';
import lossyLine from './lossy-line';
import ltspiceFunction from './ltspice-function';
import lumpedLossyLine from './lumped-lossy-line';
import memristor from './memristor';
import mesfet from './mesfet';
import mosfet from './mosfet';
import multiconductorLine from './multiconductor-line';
import multipositionSwitch from './multiposition-switch';
import mutualInductance from './mutual-inductance';
import nport from './nport';
import osdiDevice from './osdi-device';
import pdeDevice from './pde-device';
import port from './port';
import reluctor from './reluctor';
import resistor from './resistor';
import soiMosfet from './soi-mosfet';
import subcircuit from './subcircuit';
import transformer from './transformer';
import transline from './transline';
import txlLine from './txl-line';
import urcLine from './urc-line';
import vccs from './vccs';
import vcvs from './vcvs';
import vdmos from './vdmos';
import vsource from './vsource';
import vswitch from './vswitch';
import xspiceModel from './xspice-model';
import xyceDevice from './xyce-device';

const ENTRIES = {
  ammeter,
  'behavioural-source': behaviouralSource,
  bjt,
  capacitor,
  cccs,
  ccvs,
  'coupled-lossy-line': coupledLossyLine,
  'cpl-line': cplLine,
  'digital-adc': digitalAdc,
  'digital-adder': digitalAdder,
  'digital-constraint': digitalConstraint,
  'digital-dac': digitalDac,
  'digital-delay-line': digitalDelayLine,
  'digital-flip-flop': digitalFlipFlop,
  'digital-gate': digitalGate,
  'digital-gate-array': digitalGateArray,
  'digital-input': digitalInput,
  'digital-latch': digitalLatch,
  'digital-logic-expression': digitalLogicExpression,
  'digital-output': digitalOutput,
  'digital-pin-delay': digitalPinDelay,
  'digital-pld': digitalPld,
  'digital-pull': digitalPull,
  'digital-ram': digitalRam,
  'digital-rom': digitalRom,
  'digital-stimulus': digitalStimulus,
  'digital-transfer-gate': digitalTransferGate,
  'digital-tristate-gate': digitalTristateGate,
  diode,
  fra,
  'fra-probe': fraProbe,
  gaasfet,
  'ibis-buffer': ibisBuffer,
  'ideal-delay': idealDelay,
  igbt,
  inductor,
  isource,
  iswitch,
  jfet,
  'lossless-line': losslessLine,
  'lossy-line': lossyLine,
  'ltspice-function': ltspiceFunction,
  'lumped-lossy-line': lumpedLossyLine,
  memristor,
  mesfet,
  mosfet,
  'multiconductor-line': multiconductorLine,
  'multiposition-switch': multipositionSwitch,
  'mutual-inductance': mutualInductance,
  nport,
  'osdi-device': osdiDevice,
  'pde-device': pdeDevice,
  port,
  reluctor,
  resistor,
  'soi-mosfet': soiMosfet,
  subcircuit,
  transformer,
  transline,
  'txl-line': txlLine,
  'urc-line': urcLine,
  vccs,
  vcvs,
  vdmos,
  vsource,
  vswitch,
  'xspice-model': xspiceModel,
  'xyce-device': xyceDevice
} as const satisfies Record<string, ElementType>;

/** An element type's id: the name of its file in `src/catalogue/`. */
export type ElementTypeId = keyof typeof ENTRIES;

/** Every element type by id. */
export const CATALOGUE: Readonly<Record<ElementTypeId, ElementType>> = ENTRIES;

export const ELEMENT_TYPE_IDS = Object.keys(CATALOGUE) as ElementTypeId[];

export function elementType(id: ElementTypeId): ElementType {
  return CATALOGUE[id];
}

/** What is known about an element when its type is looked up; every hint is optional. */
export interface SpellingHints {
  /** Its model's `.model` type, lower-cased, when the model is defined. */
  modelType?: string;
  /** The model's `LEVEL`, when given. */
  modelLevel?: number;
  /** The Xyce `Y` suffix, upper-cased. */
  suffix?: string;
  /** Keyword tokens on the line, upper-cased. */
  keywords?: readonly string[];
  /** The keys of `key=value` pairs on the line, upper-cased. */
  pairKeys?: readonly string[];
}

function selects(select: Select, hints: SpellingHints): boolean {
  switch (select.by) {
    case 'model-type':
      return hints.modelType !== undefined && select.types.includes(hints.modelType)
        && (select.levels === undefined || (hints.modelLevel !== undefined && select.levels.includes(hints.modelLevel)));
    case 'suffix':
      return hints.suffix !== undefined && select.suffixes.includes(hints.suffix);
    case 'keyword':
      return hints.keywords !== undefined && select.keywords.some((keyword) => hints.keywords!.includes(keyword));
    case 'pair':
      return hints.pairKeys !== undefined && select.keys.some((key) => hints.pairKeys!.includes(key.toUpperCase()));
  }
}

/** Every (type, spelling) pair of one dialect. */
export function spellingsOf(dialect: DialectId): { id: ElementTypeId; spelling: Spelling }[] {
  const found: { id: ElementTypeId; spelling: Spelling }[] = [];
  for (const id of ELEMENT_TYPE_IDS) {
    for (const spelling of CATALOGUE[id].spellings) {
      if (spelling.dialect === dialect) found.push({ id, spelling });
    }
  }
  return found;
}

/**
 * The element type a SPICE dialect's letter names, given what the line and its model say. Types
 * whose selector matches win over the letter's fallback; `undefined` when the dialect has no such
 * letter.
 */
export function elementTypeForLetter(dialect: Exclude<DialectId, 'spectre'>, letter: string, hints: SpellingHints = {}): ElementTypeId | undefined {
  const upper = letter.toUpperCase();
  let fallback: ElementTypeId | undefined;
  for (const { id, spelling } of spellingsOf(dialect)) {
    if (spelling.dialect === 'spectre' || spelling.letter !== upper) continue;
    if (spelling.select === undefined) fallback = id;
    else if (selects(spelling.select, hints)) return id;
  }
  return fallback;
}

/** The element type a Spectre master names; a master the catalogue does not know is a subcircuit or module. */
export function elementTypeForMaster(master: string): ElementTypeId {
  let fallback: ElementTypeId = 'subcircuit';
  for (const { id, spelling } of spellingsOf('spectre')) {
    if (spelling.dialect !== 'spectre') continue;
    if (spelling.master === master) return id;
    if (spelling.master === '*') fallback = id;
  }
  return fallback;
}
