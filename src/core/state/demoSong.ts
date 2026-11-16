import type { ChordStepConfig } from '../theory/progression';
import { createInitialHistory } from './HistoryTree';
import {
  createChanceOperatorConfig,
  createDefaultLayer,
  createSwingOperatorConfig,
  findCardId,
  insertTimeOperator,
  updateCard,
  updateOperator,
} from './presets';
import type {
  BeatSnapshot,
  LayerConfig,
  ModulationRouteConfig,
  ProjectDocument,
  SectionItem,
} from './types';

/**
 * Demo-Song „Nachtschicht“ – melodischer Techno in D-Moll, 128 BPM, 6 Abschnitte (128 Takte).
 *
 * Aufbau des Grooves (Peak):
 *   Kick 4/4 · 16tel-Hats mit Swing & Ghost-Notes · offene Hat auf den Offbeats ·
 *   Clap auf 2 & 4 · rollender Sub-Bass (.xxx) · Acid-Linie (10 aus 16, öffnet sich über 32 Takte) ·
 *   Dub-Akkord-Stab (Tresillo 3/8, Echo) · Glocken-Motiv (Motiv-Entwicklung) ·
 *   im Break: Orgel-Fläche, Snare-Wirbel (euklidisch wachsend) & Rausch-Riser.
 *
 * Alle Layer werden EINMAL gebaut und pro Abschnitt nur variiert → gleiche IDs in allen
 * Abschnitten, die Engine verwendet beim Abschnittswechsel dieselben Instanzen weiter
 * (keine Knackser, Hallfahnen laufen durch).
 */

const BPB = 4;

interface EuclidSpec {
  steps: number;
  hits: number;
  rotation: number;
  gate?: number;
  accent?: number;
}

export function withEuclid(layer: LayerConfig, e: EuclidSpec): LayerConfig {
  let ops = updateOperator(layer.timeOperators, 'time-pulse-interference', { bypassed: true });
  ops = updateOperator(ops, 'time-euclid', {
    bypassed: false,
    params: {
      euclidSteps: e.steps,
      euclidHits: e.hits,
      euclidRotation: e.rotation,
      euclidGate: e.gate ?? 0.5,
      euclidAccent: e.accent ?? 0.35,
      euclidMode: 0,
    },
  });
  return { ...layer, timeOperators: ops };
}

export function withPulse(layer: LayerConfig, freqA: number): LayerConfig {
  return {
    ...layer,
    timeOperators: updateOperator(layer.timeOperators, 'time-pulse-interference', {
      bypassed: false,
      params: { freqA, freqB: freqA, interferenceMix: 0, phaseOffset: 0, threshold: 0, waveShape: 0 },
    }),
  };
}

export function chain(
  layer: LayerConfig,
  patches: Record<string, { bypassed?: boolean; params?: Record<string, number> }>,
): LayerConfig {
  let c = layer.processorChain;
  for (const [moduleId, patch] of Object.entries(patches)) c = updateCard(c, moduleId, patch);
  return { ...layer, processorChain: c };
}

export function voice(layer: LayerConfig, params: Record<string, number>): LayerConfig {
  return { ...layer, voice: { ...layer.voice, params: { ...layer.voice.params, ...params } } };
}

export function base(
  id: string,
  name: string,
  voiceId: string,
  color: string,
  group: string,
  cycleValue = 4,
  cycleUnit: 'beats' | 'bars' = 'beats',
): LayerConfig {
  const l = createDefaultLayer(name, voiceId, cycleValue, cycleUnit);
  return { ...l, id, color, group };
}

export function lfo(
  id: string,
  label: string,
  targetDomain: ModulationRouteConfig['targetDomain'],
  targetCardId: string,
  targetParamId: string,
  waveform: 'sine' | 'triangle' | 'ramp-up' | 'ramp-down',
  bars: number,
  depth: number,
  phaseOffset = 0,
): ModulationRouteConfig {
  return {
    id,
    label,
    enabled: true,
    sourceType: 'wave-lfo',
    sourceConfig: { waveform, cycleValue: bars, cycleUnit: 'bars', phaseOffset },
    targetDomain,
    targetCardId,
    targetParamId,
    combineMode: 'add',
    depth,
  };
}

interface DemoLayers {
  kick: LayerConfig;
  hats: LayerConfig;
  openHat: LayerConfig;
  clap: LayerConfig;
  bass: LayerConfig;
  acid: LayerConfig;
  stab: LayerConfig;
  bell: LayerConfig;
  pad: LayerConfig;
  roll: LayerConfig;
  riser: LayerConfig;
}

function buildLayers(): DemoLayers {
  // --- Kick: 4/4 Fundament -------------------------------------------------
  let kick = withPulse(base('ns_kick', 'Kick 4/4', 'pulse-texture', '#ff6b4a', 'Drums'), 4);
  kick = voice(kick, { bodyAir: 0.1, punchDrop: 0.78, decay: 0.34, snap: 0.62, pitchOffset: 0, toneColor: 0.24 });
  kick = chain(kick, {
    'card-tone-filter': { params: { brightness: 0.5, focus: 0.18, filterMode: 0, tilt: -0.15 } },
    'card-warmth-wavefold': { params: { warmthGrit: 0.22, wavefold: 0 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
    'card-eq-orbit': { params: { lowDb: 2.5, midDb: -1.5, highDb: -1, stereoOrbit: 0 } },
  });
  kick = { ...kick, level: 0.88 };

  // --- 16tel-Hats mit Swing, Zufall & Ghost-Notes --------------------------
  let hats = withPulse(base('ns_hats', 'Hats 16tel (Swing)', 'metal-hat', '#facc15', 'Drums'), 16);
  hats = {
    ...hats,
    timeOperators: updateOperator(
      updateOperator(
        insertTimeOperator(
          insertTimeOperator(hats.timeOperators, createSwingOperatorConfig(hats.id)),
          createChanceOperatorConfig(hats.id),
        ),
        'time-swing',
        { bypassed: false, params: { swingAmount: 0.14, swingGrid: 4 } },
      ),
      'time-chance',
      {
        bypassed: false,
        params: { chance: 0.75, ghost: 0.65, humanize: 0.4, chanceSeed: 5, chanceLoop: 2, protectDownbeat: 0 },
      },
    ),
  };
  hats = voice(hats, { openness: 0.05, tone: 0.62, metalNoise: 0.55, tune: 0, dynamics: 0.75, width: 0.45 });
  hats = chain(hats, {
    'card-tone-filter': { params: { brightness: 0.97, focus: 0.15, filterMode: 0, tilt: 0.15 } },
    'card-warmth-wavefold': { params: { warmthGrit: 0.06, wavefold: 0 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0.02 } },
    'card-eq-orbit': { params: { lowDb: -8, midDb: -1, highDb: 1, stereoOrbit: 1.0 } },
  });
  hats = { ...hats, level: 0.9, pan: 0.1 };

  // --- Offene Hat auf den Offbeats ----------------------------------------
  let openHat = withEuclid(base('ns_ohat', 'Offene Hat (Offbeat)', 'metal-hat', '#fb923c', 'Drums'), {
    steps: 8,
    hits: 4,
    rotation: 1,
    gate: 0.6,
    accent: 0,
  });
  openHat = voice(openHat, { openness: 0.4, tone: 0.55, metalNoise: 0.42, tune: -2, dynamics: 0.2, width: 0.6 });
  openHat = chain(openHat, {
    'card-tone-filter': { params: { brightness: 0.92, focus: 0.15, filterMode: 0, tilt: 0.1 } },
    'card-warmth-wavefold': { params: { warmthGrit: 0.04, wavefold: 0 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
    'card-eq-orbit': { params: { lowDb: -9, midDb: -1, highDb: 0.5, stereoOrbit: 1.1 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.12, size: 0.45, decay: 0.4, brightness: 0.6, duckAmount: 0.5 } },
  });
  openHat = { ...openHat, level: 0.7, pan: -0.12 };

  // --- Clap auf 2 & 4 -----------------------------------------------------
  let clap = withEuclid(base('ns_clap', 'Clap 2 & 4', 'clap-snare', '#f472b6', 'Drums'), {
    steps: 4,
    hits: 2,
    rotation: 1,
    gate: 0.5,
    accent: 0,
  });
  clap = voice(clap, { clapSnare: 0.3, tone: 0.55, decay: 0.3, spread: 0.5, bodyTune: 0, snappy: 0.5, width: 0.5 });
  clap = chain(clap, {
    'card-tone-filter': { params: { brightness: 0.86, focus: 0.2, filterMode: 0, tilt: 0.05 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
    'card-eq-orbit': { params: { lowDb: -6, midDb: 0.5, highDb: 0.5, stereoOrbit: 0.8 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.24, size: 0.52, decay: 0.48, brightness: 0.5, duckAmount: 0.5 } },
  });
  clap = { ...clap, level: 0.95 };

  // --- Rollender Sub-Bass: .xxx .xxx .xxx .xxx ----------------------------
  let bass = withEuclid(base('ns_bass', 'Rollender Bass', 'sub-motion', '#38bdf8', 'Bass'), {
    steps: 16,
    hits: 12,
    rotation: 3,
    gate: 0.62,
    accent: 0.2,
  });
  bass = voice(bass, { subWarmth: 0.74, phaseBite: 0.32, glide: 0.02, octaveShift: -1, autoDuck: 0.72, sustainHold: 0.3 });
  bass = chain(bass, {
    'card-tone-filter': { params: { brightness: 0.42, focus: 0.3, filterMode: 0, tilt: -0.2 } },
    'card-warmth-wavefold': { params: { warmthGrit: 0.18, wavefold: 0 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
    'card-eq-orbit': { params: { lowDb: 1, midDb: -1, highDb: -3, stereoOrbit: 0 } },
  });
  bass = { ...bass, level: 0.92 };

  // --- Acid-Linie: 10 aus 16, öffnet sich langsam --------------------------
  let acid = withEuclid(base('ns_acid', 'Acid-Linie', 'acid-line', '#a3e635', 'Bass'), {
    steps: 16,
    hits: 10,
    rotation: 2,
    gate: 0.7,
    accent: 0.3,
  });
  acid = voice(acid, {
    wave: 0.15,
    cutoff: 0.34,
    resonance: 0.74,
    envMod: 0.58,
    decay: 0.2,
    noteLength: 0.32,
    accent: 0.4,
    slide: 0.3,
    drive: 0.42,
    octaveShift: 0,
    melodyPattern: 10,
    melodyRange: 0.45,
    melodyRate: 1,
    melodyLength: 10,
    melodySeed: 23,
    melodyLeap: 0.35,
    melodyChordTones: 0.55,
    melodyRest: 0.12,
  });
  acid = chain(acid, {
    'card-tone-filter': { params: { brightness: 0.88, focus: 0.2, filterMode: 0, tilt: 0 } },
    'card-warmth-wavefold': { params: { warmthGrit: 0.1, wavefold: 0 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
    'card-eq-orbit': { params: { lowDb: -4, midDb: 0.5, highDb: 0, stereoOrbit: 0.5 } },
    'card-tempo-echo': { bypassed: false, params: { mix: 0.16, division: 1, feedback: 0.35, darkening: 0.5, pingPong: 1 } },
  });
  acid = {
    ...acid,
    level: 0.75,
    modulations: [lfo('ns_mod_acid_cutoff', 'Acid öffnet sich (32 Takte)', 'voice', 'voice', 'cutoff', 'ramp-up', 32, 0.2)],
  };

  // --- Dub-Akkord-Stab (Tresillo) -----------------------------------------
  let stab = withEuclid(base('ns_stab', 'Dub-Akkord-Stab', 'chord-arp', '#22c55e', 'Harmonie'), {
    steps: 8,
    hits: 3,
    rotation: 1,
    gate: 0.32,
    accent: 0.3,
  });
  stab = voice(stab, {
    chordArpMorph: 0.04,
    arpSpeed: 2,
    arpPattern: 0,
    octaveSpread: 1,
    timbreShape: 0.48,
    detuneShimmer: 0.42,
    softness: 0.07,
    droneHold: 0,
  });
  stab = chain(stab, {
    'card-tone-filter': { params: { brightness: 0.52, focus: 0.38, filterMode: 0, tilt: 0 } },
    'card-eq-orbit': { params: { lowDb: -6, midDb: 0.5, highDb: 0, stereoOrbit: 1.2 } },
    'card-tempo-echo': { bypassed: false, params: { mix: 0.3, division: 1, feedback: 0.52, darkening: 0.58, pingPong: 1 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.26, size: 0.66, decay: 0.66, brightness: 0.45, duckAmount: 0.6 } },
  });
  const stabToneId = findCardId(stab.processorChain, 'card-tone-filter');
  stab = {
    ...stab,
    level: 1.3,
    pan: 0.05,
    modulations: [lfo('ns_mod_stab_bright', 'Stab atmet (8 Takte)', 'processor', stabToneId, 'brightness', 'triangle', 8, 0.12)],
  };

  // --- Glocken-Motiv (Motiv-Entwicklung) ----------------------------------
  let bell = withEuclid(base('ns_bell', 'Glocken-Motiv', 'modal-bell', '#f59e0b', 'Melodie'), {
    steps: 16,
    hits: 5,
    rotation: 2,
    gate: 0.5,
    accent: 0.4,
  });
  bell = voice(bell, {
    material: 0.86,
    malletHardness: 0.55,
    decay: 0.85,
    shimmer: 0.4,
    octaveShift: 1,
    melodyPattern: 12,
    melodyRange: 0.55,
    melodyRate: 1,
    melodyLength: 0,
    melodySeed: 11,
    melodyLeap: 0.12,
    melodyChordTones: 0.6,
    melodyRest: 0.1,
  });
  bell = chain(bell, {
    'card-tone-filter': { params: { brightness: 0.78, focus: 0.25, filterMode: 0, tilt: 0.15 } },
    'card-eq-orbit': { params: { lowDb: -6, midDb: 0, highDb: 1.5, stereoOrbit: 1.25 } },
    'card-tempo-echo': { bypassed: false, params: { mix: 0.26, division: 1, feedback: 0.42, darkening: 0.45, pingPong: 1 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.3, size: 0.7, decay: 0.7, brightness: 0.55, duckAmount: 0.55 } },
  });
  bell = { ...bell, level: 0.68, pan: -0.16 };

  // --- Orgel-Fläche (Break) -----------------------------------------------
  let pad = withPulse(base('ns_pad', 'Orgel-Fläche', 'pipe-organ', '#a855f7', 'Harmonie'), 1);
  pad = voice(pad, {
    register: 0.36,
    chiff: 0.08,
    tremolo: 0.34,
    release: 0.75,
    droneHold: 1,
    voiceMode: 2,
    octaveShift: 0,
    melodyPattern: 0,
  });
  pad = chain(pad, {
    'card-tone-filter': { params: { brightness: 0.46, focus: 0.2, filterMode: 0, tilt: -0.05 } },
    'card-eq-orbit': { params: { lowDb: -5, midDb: 0, highDb: 0, stereoOrbit: 1.3 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.42, size: 0.82, decay: 0.8, brightness: 0.45, duckAmount: 0.4 } },
  });
  pad = { ...pad, level: 0.6 };

  // --- Snare-Wirbel: Schläge wachsen von 2 auf 16 pro Takt -----------------
  let roll = withEuclid(base('ns_roll', 'Snare-Wirbel (Aufbau)', 'clap-snare', '#e879f9', 'Drums'), {
    steps: 16,
    hits: 9,
    rotation: 0,
    gate: 0.4,
    accent: 0.2,
  });
  roll = voice(roll, { clapSnare: 0.85, tone: 0.6, decay: 0.14, spread: 0.2, bodyTune: 2, snappy: 0.7, width: 0.35 });
  roll = chain(roll, {
    'card-tone-filter': { params: { brightness: 0.88, focus: 0.2, filterMode: 0, tilt: 0.1 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
    'card-eq-orbit': { params: { lowDb: -7, midDb: 0, highDb: 0.5, stereoOrbit: 0.7 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.2, size: 0.5, decay: 0.42, brightness: 0.5, duckAmount: 0.3 } },
  });
  const rollEuclidId = roll.timeOperators.find((o) => o.moduleId === 'time-euclid')?.id ?? '';
  roll = {
    ...roll,
    level: 0.42,
    modulations: [
      lfo('ns_mod_roll_hits', 'Wirbel verdichtet sich (16 Takte)', 'time', rollEuclidId, 'euclidHits', 'ramp-up', 16, 0.22),
      lfo('ns_mod_roll_level', 'Wirbel wird lauter', 'voice', 'layer-mix', 'level', 'ramp-up', 16, 0.12),
    ],
  };

  // --- Rausch-Riser über 16 Takte -----------------------------------------
  let riser = base('ns_riser', 'Rausch-Riser (16 Takte)', 'noise-riser', '#94a3b8', 'FX', 16, 'bars');
  riser = {
    ...riser,
    timeOperators: updateOperator(riser.timeOperators, 'time-pulse-interference', { bypassed: true }),
  };
  riser = voice(riser, { direction: 0, sweepRange: 0.8, tension: 0.62, resonance: 0.42, toneMix: 0.18, pulseGate: 0, width: 0.85 });
  riser = chain(riser, {
    'card-tone-filter': { params: { brightness: 1, focus: 0.1, filterMode: 0, tilt: 0 } },
    'card-warmth-wavefold': { params: { warmthGrit: 0.05, wavefold: 0 } },
    'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
    'card-eq-orbit': { params: { lowDb: -10, midDb: 0, highDb: 0, stereoOrbit: 1.3 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.3, size: 0.75, decay: 0.7, brightness: 0.55, duckAmount: 0.3 } },
  });
  riser = { ...riser, level: 0.75 };

  return { kick, hats, openHat, clap, bass, acid, stab, bell, pad, roll, riser };
}

function progressionSteps(): ChordStepConfig[] {
  // i – VI – III – VII, je 2 Takte, weich überblendet
  const mk = (id: string, degree: number): ChordStepConfig => ({
    id,
    degree,
    accidental: 0,
    chordType: 'auto',
    durationBeats: 8,
    transitionType: 'crossfade',
    transitionBeats: 0.5,
  });
  return [mk('ns_ch_1', 0), mk('ns_ch_2', 5), mk('ns_ch_3', 2), mk('ns_ch_4', 6)];
}

function snapshot(id: string, layers: LayerConfig[], progression: boolean): BeatSnapshot {
  return {
    id,
    tempoBpm: 128,
    timeSignature: { numerator: BPB, denominator: 4 },
    masterGain: 0.88,
    masterGlue: 0.3,
    harmony: progression
      ? {
          rootNote: 2,
          scaleId: 'natural_minor',
          chordPreset: 'minor7',
          progressionId: 'static',
          progressionMode: 'custom',
          customSteps: progressionSteps(),
          voiceLeadingEnabled: true,
        }
      : {
          rootNote: 2,
          scaleId: 'natural_minor',
          chordPreset: 'minor7',
          progressionId: 'static',
          progressionMode: 'preset',
          voiceLeadingEnabled: true,
        },
    curves: [],
    layers,
  };
}

const lvl = (l: LayerConfig, level: number): LayerConfig => ({ ...l, level });
const mute = (l: LayerConfig): LayerConfig => ({ ...l, muted: true });
const tone = (l: LayerConfig, brightness: number): LayerConfig =>
  chain(l, { 'card-tone-filter': { params: { brightness } } });
const chanceOf = (l: LayerConfig, chance: number): LayerConfig => ({
  ...l,
  timeOperators: updateOperator(l.timeOperators, 'time-chance', { params: { chance } }),
});

/** Baut alle sechs Abschnitte des Demo-Songs. */
export function createNachtschichtSections(): SectionItem[] {
  const L = buildLayers();
  // Layer-Reihenfolge ist in allen Abschnitten gleich (übersichtlich in der Layer-Liste).
  const all = (o: Partial<DemoLayers>): LayerConfig[] => {
    const m = { ...L, ...o };
    return [m.kick, m.hats, m.openHat, m.clap, m.roll, m.bass, m.acid, m.stab, m.pad, m.bell, m.riser];
  };

  const intro = all({
    hats: chanceOf(L.hats, 0.55),
    openHat: mute(L.openHat),
    clap: mute(L.clap),
    roll: mute(L.roll),
    bass: mute(L.bass),
    acid: mute(L.acid),
    stab: lvl(tone(L.stab, 0.3), 1.1),
    pad: mute(L.pad),
    bell: mute(L.bell),
    riser: mute(L.riser),
  });

  const aufbau = all({
    hats: chanceOf(L.hats, 0.7),
    roll: mute(L.roll),
    acid: mute(L.acid),
    stab: tone(L.stab, 0.42),
    pad: mute(L.pad),
    bell: mute(L.bell),
    riser: lvl(L.riser, 0.55),
  });

  const peak = all({
    roll: mute(L.roll),
    pad: mute(L.pad),
    riser: mute(L.riser),
  });

  const brk = all({
    kick: mute(L.kick),
    hats: lvl(chanceOf(L.hats, 0.4), 0.5),
    openHat: mute(L.openHat),
    clap: mute(L.clap),
    bass: mute(L.bass),
    acid: mute(L.acid),
    stab: mute(L.stab),
    bell: lvl(L.bell, 0.85),
    pad: L.pad,
  });

  const dropAcid: LayerConfig = {
    ...voice(L.acid, { cutoff: 0.44, envMod: 0.66, resonance: 0.78, melodySeed: 41, melodyLeap: 0.45 }),
    level: 0.78,
    modulations: [lfo('ns_mod_acid_cutoff', 'Acid tanzt (16 Takte)', 'voice', 'voice', 'cutoff', 'triangle', 16, 0.16)],
  };
  const drop = all({
    hats: chanceOf(L.hats, 0.88),
    openHat: lvl(L.openHat, 0.8),
    roll: mute(L.roll),
    acid: dropAcid,
    pad: lvl(L.pad, 0.3),
    riser: mute(L.riser),
  });

  const outro = all({
    hats: chanceOf(L.hats, 0.6),
    clap: mute(L.clap),
    roll: mute(L.roll),
    acid: mute(L.acid),
    stab: lvl(tone(L.stab, 0.32), 1.05),
    pad: mute(L.pad),
    bell: mute(L.bell),
    riser: mute(L.riser),
  });

  const sec = (
    id: string,
    name: string,
    color: string,
    bars: number,
    notes: string,
    layers: LayerConfig[],
    progression: boolean,
  ): SectionItem => ({ id, name, color, exportBars: bars, notes, snapshot: snapshot(`snap_${id}`, layers, progression) });

  return [
    sec('ns_sec_intro', '01 Intro', '#64748b', 16, 'Kick, Hats & dunkler Stab auf der Tonika', intro, false),
    sec('ns_sec_aufbau', '02 Aufbau', '#38bdf8', 16, 'Bass, Clap & Offbeat-Hat kommen, Riser zieht hoch', aufbau, true),
    sec('ns_sec_peak', '03 Peak', '#22c55e', 32, 'Acid-Linie öffnet sich über 32 Takte, Glocken-Motiv', peak, true),
    sec('ns_sec_break', '04 Break', '#a855f7', 16, 'Ohne Kick: Orgel, Glocken, Snare-Wirbel & Riser', brk, true),
    sec('ns_sec_drop', '05 Drop', '#f97316', 32, 'Alles zurück, Acid heller & wilder', drop, true),
    sec('ns_sec_outro', '06 Outro', '#64748b', 16, 'Zurück auf die Tonika, ausdünnen', outro, false),
  ];
}

/** Komplettes Projekt mit allen Abschnitten; aktiver Beat = Peak. */
export function createNachtschichtProject(): ProjectDocument {
  const sections = createNachtschichtSections();
  const active = sections[2]!.snapshot;
  const history = createInitialHistory(active, 'Demo-Song „Nachtschicht“ geladen');
  return {
    id: 'proj_nachtschicht',
    name: 'Nachtschicht',
    version: 1,
    updatedAt: Date.now(),
    activeSnapshot: active,
    activeHistoryNodeId: history.activeNodeId,
    historyNodes: history.nodes,
    sections,
  };
}
