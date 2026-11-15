import type { DrawnCurveData } from '../math/curves';
import type { CycleUnit } from '../theory/cycles';
import { createInitialHistory } from './HistoryTree';
import type {
  BeatSnapshot,
  LayerConfig,
  ModulationRouteConfig,
  OperatorConfig,
  ProcessorCardConfig,
  ProjectDocument,
  SectionItem,
} from './types';

let presetIdCounter = 0;

function nextId(prefix: string): string {
  presetIdCounter += 1;
  return `${prefix}_${presetIdCounter.toString(36)}`;
}

function defaultVoiceParams(voiceModuleId: string): Record<string, number> {
  switch (voiceModuleId) {
    case 'pulse-texture':
      return {
        bodyAir: 0.32,
        punchDrop: 0.65,
        decay: 0.28,
        snap: 0.6,
        pitchOffset: 0,
        toneColor: 0.25,
      };
    case 'sub-motion':
      return {
        subWarmth: 0.78,
        phaseBite: 0.22,
        glide: 0.04,
        octaveShift: -1,
        autoDuck: 0.55,
        sustainHold: 0.6,
      };
    case 'chord-arp':
      return {
        chordArpMorph: 0.22,
        arpSpeed: 2,
        arpPattern: 0,
        octaveSpread: 1.5,
        timbreShape: 0.35,
        detuneShimmer: 0.35,
        softness: 0.14,
        droneHold: 0,
      };
    case 'modal-bell':
      return {
        material: 0.82,
        malletHardness: 0.6,
        decay: 0.8,
        shimmer: 0.38,
        octaveShift: 1,
        melodyPattern: 1,
        melodyRange: 0.5,
      };
    case 'pipe-organ':
      return {
        register: 0.58,
        chiff: 0.38,
        tremolo: 0.28,
        release: 0.32,
        droneHold: 0,
        voiceMode: 0,
        octaveShift: 1,
        melodyPattern: 1,
      };
    default:
      return {};
  }
}

function createDefaultTimeOperators(prefix: string): OperatorConfig[] {
  return [
    {
      id: `${prefix}_time_warp`,
      moduleId: 'time-warp',
      version: 1,
      bypassed: false,
      params: {
        warpAmount: 0,
      },
    },
    {
      id: `${prefix}_time_gravity`,
      moduleId: 'time-grid-gravity',
      version: 1,
      bypassed: false,
      params: {
        subdivisions: 4,
        phaseShift: 0,
        gravity: 0,
      },
    },
    {
      id: `${prefix}_time_drift`,
      moduleId: 'time-phase-drift',
      version: 1,
      bypassed: true,
      params: {
        driftSteps: 0,
        resetCycles: 8,
      },
    },
    {
      id: `${prefix}_time_interference`,
      moduleId: 'time-pulse-interference',
      version: 1,
      bypassed: false,
      params: {
        freqA: 4,
        freqB: 4,
        interferenceMix: 0,
        phaseOffset: 0,
        threshold: 0,
        waveShape: 0,
      },
    },
  ];
}

function createDefaultProcessorChain(prefix: string): ProcessorCardConfig[] {
  return [
    {
      id: `${prefix}_card_tone`,
      moduleId: 'card-tone-filter',
      version: 1,
      bypassed: false,
      params: {
        brightness: 0.65,
        focus: 0.25,
        filterMode: 0,
        tilt: 0,
      },
    },
    {
      id: `${prefix}_card_warmth`,
      moduleId: 'card-warmth-wavefold',
      version: 1,
      bypassed: false,
      params: {
        warmthGrit: 0.2,
        wavefold: 0.06,
      },
    },
    {
      id: `${prefix}_card_body`,
      moduleId: 'card-body-sand',
      version: 1,
      bypassed: false,
      params: {
        bodyResonance: 0.1,
        bodyCharacter: 0.35,
        sandDust: 0.04,
      },
    },
    {
      id: `${prefix}_card_eq`,
      moduleId: 'card-eq-orbit',
      version: 1,
      bypassed: false,
      params: {
        lowDb: 0,
        midDb: 0,
        highDb: 0,
        stereoOrbit: 1.0,
      },
    },
    {
      id: `${prefix}_card_echo`,
      moduleId: 'card-tempo-echo',
      version: 1,
      bypassed: true,
      params: {
        mix: 0.15,
        division: 1,
        feedback: 0.38,
        darkening: 0.45,
        pingPong: 1,
      },
    },
    {
      id: `${prefix}_card_hall`,
      moduleId: 'card-ducking-hall',
      version: 1,
      bypassed: true,
      params: {
        mix: 0.18,
        size: 0.55,
        decay: 0.6,
        brightness: 0.45,
        duckAmount: 0.5,
      },
    },
  ];
}

const LAYER_COLORS = [
  '#ff6b4a',
  '#38bdf8',
  '#a855f7',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
];

/**
 * Creates a clean default LayerConfig ready for the UI or presets.
 */
export function createDefaultLayer(
  name: string,
  voiceModuleId: string,
  cycleValue = 4,
  cycleUnit: CycleUnit = 'beats',
): LayerConfig {
  const id = nextId('layer');
  const colorIndex = presetIdCounter % LAYER_COLORS.length;
  return {
    id,
    name,
    color: LAYER_COLORS[colorIndex] ?? '#38bdf8',
    enabled: true,
    muted: false,
    solo: false,
    level: 0.8,
    pan: 0,
    cycleLength: {
      value: cycleValue,
      unit: cycleUnit,
    },
    timeOperators: createDefaultTimeOperators(id),
    voice: {
      moduleId: voiceModuleId,
      version: 1,
      params: defaultVoiceParams(voiceModuleId),
    },
    processorChain: createDefaultProcessorChain(id),
    modulations: [],
  };
}

function updateOperator(
  ops: readonly OperatorConfig[],
  moduleId: string,
  patch: { bypassed?: boolean; params?: Record<string, number> },
): OperatorConfig[] {
  return ops.map((op) =>
    op.moduleId === moduleId
      ? {
          ...op,
          bypassed: patch.bypassed ?? op.bypassed,
          params: patch.params ? { ...op.params, ...patch.params } : op.params,
        }
      : op,
  );
}

function updateCard(
  chain: readonly ProcessorCardConfig[],
  moduleId: string,
  patch: { bypassed?: boolean; params?: Record<string, number> },
): ProcessorCardConfig[] {
  return chain.map((card) =>
    card.moduleId === moduleId
      ? {
          ...card,
          bypassed: patch.bypassed ?? card.bypassed,
          params: patch.params ? { ...card.params, ...patch.params } : card.params,
        }
      : card,
  );
}

function findCardId(chain: readonly ProcessorCardConfig[], moduleId: string): string {
  return chain.find((c) => c.moduleId === moduleId)?.id ?? '';
}

function findOpId(ops: readonly OperatorConfig[], moduleId: string): string {
  return ops.find((o) => o.moduleId === moduleId)?.id ?? '';
}

function createHypnoticSnapshot(): BeatSnapshot {
  const curveMorph: DrawnCurveData = {
    id: 'curve_arp_bloom',
    name: 'Akkord-zu-Arp Bogen (8 Takte)',
    cycleValue: 8,
    cycleUnit: 'bars',
    snapDivision: 8,
    points: [
      { x: 0, y: 0.05 },
      { x: 0.25, y: 0.22 },
      { x: 0.55, y: 0.72 },
      { x: 0.8, y: 0.95 },
      { x: 1, y: 0.1 },
    ],
  };

  // L1: Kick & Sub-Puls
  const baseL1 = createDefaultLayer('L1 Kick & Sub-Puls', 'pulse-texture', 4, 'beats');
  const l1Ops = updateOperator(
    updateOperator(baseL1.timeOperators, 'time-pulse-interference', {
      params: { freqA: 4, freqB: 4, interferenceMix: 0, phaseOffset: 0, threshold: 0 },
    }),
    'time-grid-gravity',
    { params: { subdivisions: 4, phaseShift: 0, gravity: 0 } },
  );
  const l1Chain = updateCard(
    updateCard(
      updateCard(baseL1.processorChain, 'card-tone-filter', {
        params: { brightness: 0.42, focus: 0.18, filterMode: 0, tilt: -0.25 },
      }),
      'card-warmth-wavefold',
      { params: { warmthGrit: 0.35, wavefold: 0.04 } },
    ),
    'card-eq-orbit',
    { params: { lowDb: 2.5, midDb: -1.5, highDb: -2, stereoOrbit: 0.2 } },
  );
  const l1: LayerConfig = {
    ...baseL1,
    id: 'layer_kick_puls',
    color: '#ff6b4a',
    level: 0.9,
    timeOperators: l1Ops,
    voice: {
      ...baseL1.voice,
      params: {
        bodyAir: 0.08,
        punchDrop: 0.85,
        decay: 0.26,
        snap: 0.72,
        pitchOffset: -12,
        toneColor: 0.18,
      },
    },
    processorChain: l1Chain,
  };

  // L2: Rollender Offbeat-Bass
  const baseL2 = createDefaultLayer('L2 Rollender Offbeat-Bass', 'sub-motion', 4, 'beats');
  const l2Ops = updateOperator(
    updateOperator(baseL2.timeOperators, 'time-grid-gravity', {
      params: { subdivisions: 4, phaseShift: 0.5, gravity: 0.85 },
    }),
    'time-pulse-interference',
    { params: { freqA: 8, freqB: 4, interferenceMix: 0.35, phaseOffset: 0.5, threshold: 0.45 } },
  );
  const l2Chain = updateCard(
    updateCard(baseL2.processorChain, 'card-tone-filter', {
      params: { brightness: 0.48, focus: 0.32, filterMode: 0, tilt: -0.3 },
    }),
    'card-warmth-wavefold',
    { params: { warmthGrit: 0.42, wavefold: 0.1 } },
  );
  const l2ToneId = findCardId(l2Chain, 'card-tone-filter');
  const l2Mods: ModulationRouteConfig[] = [
    {
      id: 'mod_l2_bright_lfo',
      label: 'Bass-Öffnung (8 Takte)',
      enabled: true,
      sourceType: 'wave-lfo',
      sourceConfig: {
        waveform: 'sine',
        cycleValue: 8,
        cycleUnit: 'bars',
        phaseOffset: 0,
      },
      targetDomain: 'processor',
      targetCardId: l2ToneId,
      targetParamId: 'brightness',
      combineMode: 'add',
      depth: 0.18,
    },
  ];
  const l2: LayerConfig = {
    ...baseL2,
    id: 'layer_offbeat_bass',
    color: '#38bdf8',
    level: 0.78,
    timeOperators: l2Ops,
    voice: {
      ...baseL2.voice,
      params: {
        subWarmth: 0.82,
        phaseBite: 0.3,
        glide: 0.03,
        octaveShift: -1,
        autoDuck: 0.65,
        sustainHold: 0.52,
      },
    },
    processorChain: l2Chain,
    modulations: l2Mods,
  };

  // L3: Phasen-Rätsel Holz/Metall (5 Beats gegen 4/4!)
  const baseL3 = createDefaultLayer('L3 Phasen-Rätsel Holz/Metall', 'pulse-texture', 5, 'beats');
  const l3Ops = updateOperator(
    updateOperator(baseL3.timeOperators, 'time-pulse-interference', {
      params: { freqA: 5, freqB: 3, interferenceMix: 0.62, phaseOffset: 0.2, threshold: 0.42 },
    }),
    'time-phase-drift',
    { bypassed: false, params: { driftSteps: 0.08, resetCycles: 8 } },
  );
  const l3Chain = updateCard(
    updateCard(
      updateCard(
        updateCard(baseL3.processorChain, 'card-body-sand', {
          params: { bodyResonance: 0.45, bodyCharacter: 0.4, sandDust: 0.12 },
        }),
        'card-tone-filter',
        { params: { brightness: 0.72, focus: 0.42, filterMode: 1, tilt: 0.25 } },
      ),
      'card-tempo-echo',
      { bypassed: false, params: { mix: 0.24, division: 1, feedback: 0.42, darkening: 0.5, pingPong: 1 } },
    ),
    'card-eq-orbit',
    { params: { lowDb: -4, midDb: 1.5, highDb: 2, stereoOrbit: 1.15 } },
  );
  const l3BodyId = findCardId(l3Chain, 'card-body-sand');
  const l3EqId = findCardId(l3Chain, 'card-eq-orbit');
  const l3Mods: ModulationRouteConfig[] = [
    {
      id: 'mod_l3_body_char',
      label: 'Holz ↔ Metall (7 Beats)',
      enabled: true,
      sourceType: 'wave-lfo',
      sourceConfig: {
        waveform: 'triangle',
        cycleValue: 7,
        cycleUnit: 'beats',
        phaseOffset: 0,
      },
      targetDomain: 'processor',
      targetCardId: l3BodyId,
      targetParamId: 'bodyCharacter',
      combineMode: 'add',
      depth: 0.45,
    },
    {
      id: 'mod_l3_orbit',
      label: 'Raum-Orbit (7 Beats)',
      enabled: true,
      sourceType: 'wave-lfo',
      sourceConfig: {
        waveform: 'cosine',
        cycleValue: 7,
        cycleUnit: 'beats',
        phaseOffset: 0.25,
      },
      targetDomain: 'processor',
      targetCardId: l3EqId,
      targetParamId: 'stereoOrbit',
      combineMode: 'add',
      depth: 0.35,
    },
  ];
  const l3: LayerConfig = {
    ...baseL3,
    id: 'layer_phase_perc',
    color: '#a855f7',
    level: 0.62,
    pan: 0.12,
    timeOperators: l3Ops,
    voice: {
      ...baseL3.voice,
      params: {
        bodyAir: 0.55,
        punchDrop: 0.35,
        decay: 0.14,
        snap: 0.78,
        pitchOffset: 12,
        toneColor: 0.55,
      },
    },
    processorChain: l3Chain,
    modulations: l3Mods,
  };

  // L4: Schwebender A-Moll Akkord -> Arp (8 Takte)
  const baseL4 = createDefaultLayer('L4 A-Moll Akkord → Arp', 'chord-arp', 8, 'bars');
  const l4Ops = updateOperator(baseL4.timeOperators, 'time-pulse-interference', {
    params: { freqA: 8, freqB: 6, interferenceMix: 0.4, phaseOffset: 0.125, threshold: 0.3 },
  });
  const l4Chain = updateCard(
    updateCard(
      updateCard(baseL4.processorChain, 'card-tone-filter', {
        params: { brightness: 0.52, focus: 0.3, filterMode: 0, tilt: 0.1 },
      }),
      'card-tempo-echo',
      { bypassed: false, params: { mix: 0.28, division: 1, feedback: 0.48, darkening: 0.55, pingPong: 1 } },
    ),
    'card-ducking-hall',
    { bypassed: false, params: { mix: 0.32, size: 0.68, decay: 0.7, brightness: 0.48, duckAmount: 0.6 } },
  );
  const l4ToneId = findCardId(l4Chain, 'card-tone-filter');
  const l4Mods: ModulationRouteConfig[] = [
    {
      id: 'mod_l4_chord_arp',
      label: 'Akkord → Arpeggio Kurve',
      enabled: true,
      sourceType: 'drawn-curve',
      sourceConfig: {
        curveId: curveMorph.id,
        cycleValue: 8,
        cycleUnit: 'bars',
      },
      targetDomain: 'voice',
      targetCardId: 'voice',
      targetParamId: 'chordArpMorph',
      combineMode: 'add',
      depth: 0.72,
    },
    {
      id: 'mod_l4_brightness',
      label: 'Filter-Öffnung mit Arp',
      enabled: true,
      sourceType: 'drawn-curve',
      sourceConfig: {
        curveId: curveMorph.id,
        cycleValue: 8,
        cycleUnit: 'bars',
      },
      targetDomain: 'processor',
      targetCardId: l4ToneId,
      targetParamId: 'brightness',
      combineMode: 'add',
      depth: 0.35,
    },
  ];
  const l4: LayerConfig = {
    ...baseL4,
    id: 'layer_chord_arp',
    color: '#22c55e',
    level: 0.64,
    timeOperators: l4Ops,
    voice: {
      ...baseL4.voice,
      params: {
        chordArpMorph: 0.1,
        arpSpeed: 4,
        arpPattern: 2,
        octaveSpread: 2,
        timbreShape: 0.45,
        detuneShimmer: 0.48,
        softness: 0.16,
      },
    },
    processorChain: l4Chain,
    modulations: l4Mods,
  };

  return {
    id: 'snap_hypnotic_aminor_main',
    tempoBpm: 130,
    timeSignature: { numerator: 4, denominator: 4 },
    masterGain: 0.9,
    masterGlue: 0.25,
    harmony: {
      rootNote: 9, // A
      scaleId: 'natural_minor',
      chordPreset: 'minor7',
      progressionId: 'hypnotic_i_VI',
    },
    curves: [curveMorph],
    layers: [l1, l2, l3, l4],
  };
}

/**
 * Creates the starter Hypnotic A-Minor project with 4 polymetric layers,
 * branching history root, and 3 ready-to-play sections.
 */
export function createHypnoticAMinorProject(): ProjectDocument {
  const mainSnapshot = createHypnoticSnapshot();

  const introSnapshot: BeatSnapshot = {
    ...mainSnapshot,
    id: 'snap_intro_puls',
    layers: mainSnapshot.layers.map((layer) => {
      if (layer.id === 'layer_offbeat_bass' || layer.id === 'layer_chord_arp') {
        return { ...layer, muted: true };
      }
      if (layer.id === 'layer_phase_perc') {
        return { ...layer, level: 0.45 };
      }
      return layer;
    }),
  };

  const breakSnapshot: BeatSnapshot = {
    ...mainSnapshot,
    id: 'snap_break_arp',
    layers: mainSnapshot.layers.map((layer) => {
      if (layer.id === 'layer_kick_puls' || layer.id === 'layer_offbeat_bass') {
        return { ...layer, muted: true };
      }
      if (layer.id === 'layer_chord_arp') {
        return {
          ...layer,
          level: 0.78,
          voice: {
            ...layer.voice,
            params: { ...layer.voice.params, chordArpMorph: 0.65 },
          },
        };
      }
      return layer;
    }),
  };

  const sections: SectionItem[] = [
    {
      id: 'sec_01_intro',
      name: '01_Intro_Puls',
      notes: 'Nur Kick-Puls und dezentes 5-Beat-Phasen-Rätsel.',
      color: '#ff6b4a',
      exportBars: 8,
      snapshot: introSnapshot,
    },
    {
      id: 'sec_02_main',
      name: '02_Main_Hypnose',
      notes: 'Alle 4 Layer aktiv, volle Polyrhythmik & Modulation.',
      color: '#38bdf8',
      exportBars: 16,
      snapshot: mainSnapshot,
    },
    {
      id: 'sec_03_break',
      name: '03_Break_Arp_Aufbau',
      notes: 'Kick & Sub pausieren, A-Moll Akkord morpht ins Arpeggio.',
      color: '#22c55e',
      exportBars: 8,
      snapshot: breakSnapshot,
    },
  ];

  const initialHistory = createInitialHistory(mainSnapshot, 'Hypnotic A-Moll Start');

  return {
    id: 'proj_hypnotic_a_minor',
    name: 'Hypnotic_A_Minor',
    version: 1,
    updatedAt: Date.now(),
    activeSnapshot: mainSnapshot,
    activeHistoryNodeId: initialHistory.activeNodeId,
    historyNodes: initialHistory.nodes,
    sections,
  };
}

/**
 * Triplet & polymetric riddle preset (3, 5, 7 beat cycles with phase-drift kaleidoscope).
 */
export function createTripletRiddlePreset(): BeatSnapshot {
  const l1Base = createDefaultLayer('Kick 4/4 Anker', 'pulse-texture', 4, 'beats');
  const l1: LayerConfig = {
    ...l1Base,
    id: 'tr_kick',
    level: 0.88,
    timeOperators: updateOperator(l1Base.timeOperators, 'time-pulse-interference', {
      params: { freqA: 4, freqB: 4, interferenceMix: 0, phaseOffset: 0, threshold: 0 },
    }),
    voice: {
      ...l1Base.voice,
      params: { bodyAir: 0.1, punchDrop: 0.8, decay: 0.25, snap: 0.65, pitchOffset: -12, toneColor: 0.2 },
    },
  };

  const l2Base = createDefaultLayer('Triolen-Rätsel (3 Beats)', 'pulse-texture', 3, 'beats');
  const l2: LayerConfig = {
    ...l2Base,
    id: 'tr_triplet_3',
    level: 0.65,
    pan: -0.25,
    timeOperators: updateOperator(
      updateOperator(l2Base.timeOperators, 'time-phase-drift', {
        bypassed: false,
        params: { driftSteps: 0.166, resetCycles: 12 },
      }),
      'time-pulse-interference',
      { params: { freqA: 3, freqB: 2, interferenceMix: 0.55, phaseOffset: 0.125, threshold: 0.4 } },
    ),
    voice: {
      ...l2Base.voice,
      params: { bodyAir: 0.5, punchDrop: 0.3, decay: 0.15, snap: 0.8, pitchOffset: 7, toneColor: 0.5 },
    },
  };

  const l3Base = createDefaultLayer('5-Beat Kaleidoskop', 'sub-motion', 5, 'beats');
  const l3: LayerConfig = {
    ...l3Base,
    id: 'tr_bass_5',
    level: 0.72,
    timeOperators: updateOperator(
      updateOperator(l3Base.timeOperators, 'time-phase-drift', {
        bypassed: false,
        params: { driftSteps: -0.1, resetCycles: 10 },
      }),
      'time-grid-gravity',
      { params: { subdivisions: 5, phaseShift: 0.5, gravity: 0.75 } },
    ),
  };

  const l4Base = createDefaultLayer('7-Beat Schimmer', 'chord-arp', 7, 'beats');
  const l4: LayerConfig = {
    ...l4Base,
    id: 'tr_arp_7',
    level: 0.58,
    pan: 0.22,
    voice: {
      ...l4Base.voice,
      params: {
        chordArpMorph: 0.55,
        arpSpeed: 3,
        arpPattern: 3,
        octaveSpread: 2,
        timbreShape: 0.4,
        detuneShimmer: 0.55,
        softness: 0.12,
      },
    },
    processorChain: updateCard(l4Base.processorChain, 'card-tempo-echo', {
      bypassed: false,
      params: { mix: 0.25, division: 3, feedback: 0.44, darkening: 0.45, pingPong: 1 },
    }),
  };

  return {
    id: 'snap_triplet_riddle',
    tempoBpm: 132,
    timeSignature: { numerator: 4, denominator: 4 },
    masterGain: 0.9,
    masterGlue: 0.28,
    harmony: {
      rootNote: 9,
      scaleId: 'phrygian',
      chordPreset: 'sus2',
      progressionId: 'phrygian_i_II',
    },
    curves: [],
    layers: [l1, l2, l3, l4],
  };
}

/**
 * Demonstrates a standing A-minor chord morphing into an accelerating arpeggio
 * and locking onto the offbeat via coupled drawn-curve routes.
 */
export function createChordToOffbeatArpPreset(): BeatSnapshot {
  const curveMorph: DrawnCurveData = {
    id: 'curve_chord_to_offbeat',
    name: 'Akkord → Beschleunigung → Offbeat',
    cycleValue: 8,
    cycleUnit: 'bars',
    snapDivision: 8,
    points: [
      { x: 0, y: 0.0 },
      { x: 0.25, y: 0.15 },
      { x: 0.5, y: 0.55 },
      { x: 0.75, y: 0.92 },
      { x: 1, y: 1.0 },
    ],
  };

  const kickBase = createDefaultLayer('Kick-Fundament', 'pulse-texture', 4, 'beats');
  const kick: LayerConfig = {
    ...kickBase,
    id: 'coa_kick',
    level: 0.86,
    timeOperators: updateOperator(kickBase.timeOperators, 'time-pulse-interference', {
      params: { freqA: 4, freqB: 4, interferenceMix: 0, phaseOffset: 0, threshold: 0 },
    }),
    voice: {
      ...kickBase.voice,
      params: { bodyAir: 0.08, punchDrop: 0.85, decay: 0.25, snap: 0.7, pitchOffset: -12, toneColor: 0.15 },
    },
  };

  const arpBase = createDefaultLayer('A-Moll Akkord → Offbeat-Arp', 'chord-arp', 8, 'bars');
  const arpOps = updateOperator(
    updateOperator(arpBase.timeOperators, 'time-grid-gravity', {
      params: { subdivisions: 4, phaseShift: 0.0, gravity: 0.85 },
    }),
    'time-warp',
    { params: { warpAmount: 0 } },
  );
  const arpChain = updateCard(
    updateCard(
      updateCard(arpBase.processorChain, 'card-tone-filter', {
        params: { brightness: 0.38, focus: 0.35, filterMode: 0, tilt: 0 },
      }),
      'card-tempo-echo',
      { bypassed: false, params: { mix: 0.26, division: 1, feedback: 0.45, darkening: 0.5, pingPong: 1 } },
    ),
    'card-ducking-hall',
    { bypassed: false, params: { mix: 0.3, size: 0.65, decay: 0.65, brightness: 0.5, duckAmount: 0.65 } },
  );

  const warpId = findOpId(arpOps, 'time-warp');
  const gravityId = findOpId(arpOps, 'time-grid-gravity');
  const toneId = findCardId(arpChain, 'card-tone-filter');

  const arpMods: ModulationRouteConfig[] = [
    {
      id: 'coa_mod_morph',
      label: 'Akkord → Arp Morph',
      enabled: true,
      sourceType: 'drawn-curve',
      sourceConfig: { curveId: curveMorph.id, cycleValue: 8, cycleUnit: 'bars' },
      targetDomain: 'voice',
      targetCardId: 'voice',
      targetParamId: 'chordArpMorph',
      combineMode: 'add',
      depth: 0.9,
    },
    {
      id: 'coa_mod_warp',
      label: 'Zeit-Beschleunigung',
      enabled: true,
      sourceType: 'drawn-curve',
      sourceConfig: { curveId: curveMorph.id, cycleValue: 8, cycleUnit: 'bars' },
      targetDomain: 'time',
      targetCardId: warpId,
      targetParamId: 'warpAmount',
      combineMode: 'add',
      depth: 0.55,
    },
    {
      id: 'coa_mod_offbeat',
      label: 'Offbeat-Einrasten',
      enabled: true,
      sourceType: 'drawn-curve',
      sourceConfig: { curveId: curveMorph.id, cycleValue: 8, cycleUnit: 'bars' },
      targetDomain: 'time',
      targetCardId: gravityId,
      targetParamId: 'phaseShift',
      combineMode: 'add',
      depth: 0.5,
    },
    {
      id: 'coa_mod_bright',
      label: 'Filter-Glanz',
      enabled: true,
      sourceType: 'drawn-curve',
      sourceConfig: { curveId: curveMorph.id, cycleValue: 8, cycleUnit: 'bars' },
      targetDomain: 'processor',
      targetCardId: toneId,
      targetParamId: 'brightness',
      combineMode: 'add',
      depth: 0.48,
    },
  ];

  const arpLayer: LayerConfig = {
    ...arpBase,
    id: 'coa_chord_arp',
    level: 0.78,
    timeOperators: arpOps,
    voice: {
      ...arpBase.voice,
      params: {
        chordArpMorph: 0.0,
        arpSpeed: 4,
        arpPattern: 0,
        octaveSpread: 2,
        timbreShape: 0.4,
        detuneShimmer: 0.45,
        softness: 0.15,
      },
    },
    processorChain: arpChain,
    modulations: arpMods,
  };

  return {
    id: 'snap_chord_to_offbeat_arp',
    tempoBpm: 128,
    timeSignature: { numerator: 4, denominator: 4 },
    masterGain: 0.9,
    masterGlue: 0.25,
    harmony: {
      rootNote: 9,
      scaleId: 'natural_minor',
      chordPreset: 'minor7',
      progressionId: 'static',
    },
    curves: [curveMorph],
    layers: [kick, arpLayer],
  };
}

/**
 * Bells & Organ dual-voice preset in A-Dorian at 126 BPM:
 * straight 4/4 kick + sub-pulse, offbeat modal-bell glockenspiel,
 * and pipe-organ layered with a secondary modal-bell voice.
 */
export function createBellsAndOrganPreset(): BeatSnapshot {
  // L1: Kick 4/4 Anker
  const l1Base = createDefaultLayer('L1 Kick 4/4 Anker', 'pulse-texture', 4, 'beats');
  const l1Ops = updateOperator(
    updateOperator(l1Base.timeOperators, 'time-pulse-interference', {
      params: { freqA: 4, freqB: 4, interferenceMix: 0, phaseOffset: 0, threshold: 0 },
    }),
    'time-grid-gravity',
    { params: { subdivisions: 4, phaseShift: 0, gravity: 0 } },
  );
  const l1Chain = updateCard(
    updateCard(l1Base.processorChain, 'card-tone-filter', {
      params: { brightness: 0.44, focus: 0.18, filterMode: 0, tilt: -0.2 },
    }),
    'card-eq-orbit',
    { params: { lowDb: 2, midDb: -1, highDb: -2, stereoOrbit: 0.2 } },
  );
  const l1: LayerConfig = {
    ...l1Base,
    id: 'bo_kick',
    color: '#ff6b4a',
    level: 0.88,
    timeOperators: l1Ops,
    voice: {
      ...l1Base.voice,
      params: {
        bodyAir: 0.08,
        punchDrop: 0.82,
        decay: 0.25,
        snap: 0.7,
        pitchOffset: -12,
        toneColor: 0.18,
      },
    },
    processorChain: l1Chain,
  };

  // L2: Sub-Puls
  const l2Base = createDefaultLayer('L2 Sub-Puls', 'sub-motion', 4, 'beats');
  const l2Ops = updateOperator(
    updateOperator(l2Base.timeOperators, 'time-grid-gravity', {
      params: { subdivisions: 4, phaseShift: 0.5, gravity: 0.7 },
    }),
    'time-pulse-interference',
    { params: { freqA: 8, freqB: 4, interferenceMix: 0.3, phaseOffset: 0.5, threshold: 0.4 } },
  );
  const l2Chain = updateCard(l2Base.processorChain, 'card-tone-filter', {
    params: { brightness: 0.46, focus: 0.3, filterMode: 0, tilt: -0.25 },
  });
  const l2: LayerConfig = {
    ...l2Base,
    id: 'bo_sub',
    color: '#38bdf8',
    level: 0.75,
    timeOperators: l2Ops,
    voice: {
      ...l2Base.voice,
      params: {
        subWarmth: 0.8,
        phaseBite: 0.25,
        glide: 0.03,
        octaveShift: -1,
        autoDuck: 0.65,
        sustainHold: 0.55,
      },
    },
    processorChain: l2Chain,
  };

  // L3: Offbeat-Glockenspiel
  const l3Base = createDefaultLayer('L3 Offbeat-Glockenspiel', 'modal-bell', 4, 'beats');
  const l3Ops = updateOperator(
    updateOperator(l3Base.timeOperators, 'time-grid-gravity', {
      params: { subdivisions: 4, phaseShift: 0, gravity: 0 },
    }),
    'time-pulse-interference',
    { params: { freqA: 4, freqB: 4, interferenceMix: 1, phaseOffset: 0.5, threshold: 0.15 } },
  );
  const l3Chain = updateCard(
    updateCard(
      updateCard(
        updateCard(l3Base.processorChain, 'card-tone-filter', {
          params: { brightness: 0.78, focus: 0.3, filterMode: 0, tilt: 0.2 },
        }),
        'card-tempo-echo',
        { bypassed: false, params: { mix: 0.26, division: 1, feedback: 0.42, darkening: 0.4, pingPong: 1 } },
      ),
      'card-ducking-hall',
      { bypassed: false, params: { mix: 0.28, size: 0.62, decay: 0.68, brightness: 0.6, duckAmount: 0.55 } },
    ),
    'card-eq-orbit',
    { params: { lowDb: -4, midDb: 0.5, highDb: 2, stereoOrbit: 1.2 } },
  );
  const l3: LayerConfig = {
    ...l3Base,
    id: 'bo_glockenspiel',
    color: '#f59e0b',
    level: 0.66,
    pan: -0.15,
    timeOperators: l3Ops,
    voice: {
      ...l3Base.voice,
      params: {
        material: 0.88,
        malletHardness: 0.65,
        decay: 0.9,
        shimmer: 0.42,
        octaveShift: 1,
        melodyPattern: 2,
        melodyRange: 0.55,
      },
    },
    processorChain: l3Chain,
  };

  // L4: Orgelpipes + Glocke-Mix (Dual-Voice Combination)
  const l4Base = createDefaultLayer('L4 Orgelpipes + Glocke-Mix', 'pipe-organ', 8, 'beats');
  const l4Ops = updateOperator(
    updateOperator(l4Base.timeOperators, 'time-grid-gravity', {
      params: { subdivisions: 4, phaseShift: 0, gravity: 0.35 },
    }),
    'time-pulse-interference',
    { params: { freqA: 4, freqB: 2, interferenceMix: 0.35, phaseOffset: 0, threshold: 0.2 } },
  );
  const l4Chain = updateCard(
    updateCard(
      updateCard(
        updateCard(l4Base.processorChain, 'card-tone-filter', {
          params: { brightness: 0.7, focus: 0.28, filterMode: 0, tilt: 0.12 },
        }),
        'card-tempo-echo',
        { bypassed: false, params: { mix: 0.2, division: 2, feedback: 0.38, darkening: 0.48, pingPong: 1 } },
      ),
      'card-ducking-hall',
      { bypassed: false, params: { mix: 0.34, size: 0.72, decay: 0.74, brightness: 0.55, duckAmount: 0.62 } },
    ),
    'card-eq-orbit',
    { params: { lowDb: -2, midDb: 1, highDb: 1.5, stereoOrbit: 1.15 } },
  );
  const l4: LayerConfig = {
    ...l4Base,
    id: 'bo_organ_bell',
    color: '#a855f7',
    level: 0.68,
    pan: 0.14,
    timeOperators: l4Ops,
    voice: {
      ...l4Base.voice,
      params: {
        register: 0.62,
        chiff: 0.42,
        tremolo: 0.32,
        release: 0.35,
        droneHold: 0,
        voiceMode: 0,
        octaveShift: 1,
        melodyPattern: 1,
      },
    },
    secondaryVoice: {
      enabled: true,
      moduleId: 'modal-bell',
      version: 1,
      mix: 0.32,
      params: {
        material: 0.72,
        malletHardness: 0.5,
        decay: 0.7,
        shimmer: 0.35,
        octaveShift: 2,
        melodyPattern: 1,
        melodyRange: 0.35,
      },
    },
    processorChain: l4Chain,
  };

  return {
    id: 'snap_bells_and_organ',
    tempoBpm: 126,
    timeSignature: { numerator: 4, denominator: 4 },
    masterGain: 0.9,
    masterGlue: 0.24,
    harmony: {
      rootNote: 9,
      scaleId: 'dorian',
      chordPreset: 'minor7',
      progressionId: 'classic_i_VI_VII_i',
    },
    curves: [],
    layers: [l1, l2, l3, l4],
  };
}
