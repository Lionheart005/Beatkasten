import { base, chain, lfo, voice, withEuclid, withPulse } from './demoSong';
import { createInitialHistory } from './HistoryTree';
import { updateOperator } from './presets';
import type { BeatSnapshot, LayerConfig, ProjectDocument, SectionItem } from './types';

/**
 * Demo „Stahlwerk“ – Hardtechno, 150 BPM, F-Phrygisch, 4 Abschnitte à 16 Takte.
 *
 *   Rumble-Kick (verzerrt, fest auf F) · gerade 16tel-Hats · offene Hat · Clap mit großem Raum ·
 *   Industrie-Bass (FM, gebrochen verzerrt) auf dem Offbeat · Metall-Percussion (euklidisch) ·
 *   verzerrte Acid-Kreischlinie · im Break: Reese-Bass mit 1/8-Wobble & Riser.
 */

const L_IDS = {
  kick: 'ht_kick',
  hats: 'ht_hats',
  openHat: 'ht_ohat',
  clap: 'ht_clap',
  perc: 'ht_perc',
  fm: 'ht_fmbass',
  acid: 'ht_acid',
  reese: 'ht_reese',
  riser: 'ht_riser',
} as const;

interface HtLayers {
  kick: LayerConfig;
  hats: LayerConfig;
  openHat: LayerConfig;
  clap: LayerConfig;
  perc: LayerConfig;
  fm: LayerConfig;
  acid: LayerConfig;
  reese: LayerConfig;
  riser: LayerConfig;
}

const flatChain = {
  'card-tone-filter': { params: { brightness: 0.9, focus: 0.15, filterMode: 0, tilt: 0 } },
  'card-warmth-wavefold': { params: { warmthGrit: 0.05, wavefold: 0 } },
  'card-body-sand': { params: { bodyResonance: 0, bodyCharacter: 0.3, sandDust: 0 } },
};

function buildLayers(): HtLayers {
  let kick = withPulse(base(L_IDS.kick, 'Rumble-Kick', 'hard-kick', '#ef4444', 'Drums'), 4);
  kick = voice(kick, {
    punch: 0.82,
    sweepTime: 0.22,
    decay: 0.3,
    distortion: 0.62,
    distMode: 1,
    tone: 0.42,
    click: 0.45,
    tune: 0,
    pitchFollow: 0,
    rumble: 0.7,
    rumbleLength: 0.72,
    rumbleGrit: 0.6,
    rumbleDark: 0.62,
  });
  kick = chain(kick, {
    ...flatChain,
    'card-tone-filter': { params: { brightness: 0.85, focus: 0.15, filterMode: 0, tilt: 0 } },
    'card-eq-orbit': { params: { lowDb: 1, midDb: -1, highDb: 0, stereoOrbit: 0 } },
  });
  kick = { ...kick, level: 0.95 };

  let hats = withPulse(base(L_IDS.hats, 'Hats 16tel (gerade)', 'metal-hat', '#facc15', 'Drums'), 16);
  hats = {
    ...hats,
    timeOperators: updateOperator(hats.timeOperators, 'time-chance', {
      bypassed: false,
      params: { chance: 0.85, ghost: 0.55, humanize: 0.25, chanceSeed: 9, chanceLoop: 1, protectDownbeat: 0 },
    }),
  };
  hats = voice(hats, { openness: 0.07, tone: 0.72, metalNoise: 0.6, tune: 2, dynamics: 0.6, width: 0.4 });
  hats = chain(hats, { ...flatChain, 'card-eq-orbit': { params: { lowDb: -9, midDb: -1, highDb: 1, stereoOrbit: 1 } } });
  hats = { ...hats, level: 1.3, pan: 0.08 };

  let openHat = withEuclid(base(L_IDS.openHat, 'Offene Hat', 'metal-hat', '#fb923c', 'Drums'), {
    steps: 8,
    hits: 4,
    rotation: 1,
    gate: 0.6,
    accent: 0,
  });
  openHat = voice(openHat, { openness: 0.32, tone: 0.65, metalNoise: 0.45, tune: 4, dynamics: 0.2, width: 0.6 });
  openHat = chain(openHat, { ...flatChain, 'card-eq-orbit': { params: { lowDb: -10, midDb: 0, highDb: 0.5, stereoOrbit: 1.1 } } });
  openHat = { ...openHat, level: 1.1, pan: -0.1 };

  let clap = withEuclid(base(L_IDS.clap, 'Clap (großer Raum)', 'clap-snare', '#f472b6', 'Drums'), {
    steps: 4,
    hits: 2,
    rotation: 1,
    gate: 0.5,
    accent: 0,
  });
  clap = voice(clap, { clapSnare: 0.55, tone: 0.62, decay: 0.42, spread: 0.55, bodyTune: 3, snappy: 0.75, width: 0.6 });
  clap = chain(clap, {
    ...flatChain,
    'card-warmth-wavefold': { params: { warmthGrit: 0.25, wavefold: 0.05 } },
    'card-eq-orbit': { params: { lowDb: -7, midDb: 1, highDb: 0.5, stereoOrbit: 0.9 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.34, size: 0.72, decay: 0.62, brightness: 0.5, duckAmount: 0.4 } },
  });
  clap = { ...clap, level: 0.85 };

  // Metallisches „Klonk“: FM mit 7×-Verhältnis, extrem kurz → Industrial-Percussion
  let perc = withEuclid(base(L_IDS.perc, 'Metall-Percussion (FM)', 'fm-bass', '#94a3b8', 'Drums'), {
    steps: 16,
    hits: 5,
    rotation: 3,
    gate: 0.5,
    accent: 0.5,
  });
  perc = voice(perc, {
    fmRatio: 6,
    fmAmount: 0.55,
    bite: 1,
    biteDecay: 0.025,
    feedback: 0.15,
    drive: 0.35,
    distMode: 0,
    tone: 0.7,
    sub: 0,
    noteLength: 0.06,
    pitchDrop: 0.5,
    octaveShift: 1,
    melodyPattern: 13,
    melodyRange: 0.6,
    melodySeed: 12,
  });
  perc = chain(perc, {
    ...flatChain,
    'card-tone-filter': { params: { brightness: 0.75, focus: 0.5, filterMode: 0, tilt: 0 } },
    'card-eq-orbit': { params: { lowDb: -8, midDb: 1.5, highDb: -1, stereoOrbit: 1.3 } },
    'card-tempo-echo': { bypassed: false, params: { mix: 0.24, division: 1, feedback: 0.4, darkening: 0.6, pingPong: 1 } },
  });
  perc = { ...perc, level: 0.5, pan: 0.15 };

  // Offbeat: in 16 Steps je Beat der 3. Step (..x.) → klassischer Hardtechno-Offbeat-Bass
  let fm = withEuclid(base(L_IDS.fm, 'Industrie-Bass (Offbeat)', 'fm-bass', '#38bdf8', 'Bass'), {
    steps: 16,
    hits: 4,
    rotation: 2,
    gate: 0.5,
    accent: 0.2,
  });
  fm = voice(fm, {
    fmRatio: 1,
    fmAmount: 0.35,
    bite: 0.7,
    biteDecay: 0.06,
    feedback: 0.3,
    drive: 0.6,
    distMode: 2,
    crush: 0.3,
    tone: 0.42,
    sub: 0.25,
    noteLength: 0.22,
    pitchDrop: 0.2,
    octaveShift: 1,
    melodyPattern: 0,
    melodyRange: 0.3,
    melodyLeap: 0.18,
    melodySeed: 4,
    melodyLength: 8,
  });
  fm = chain(fm, { ...flatChain, 'card-eq-orbit': { params: { lowDb: -2, midDb: 0.5, highDb: -2, stereoOrbit: 0 } } });
  fm = { ...fm, level: 1.2 };

  let acid = withEuclid(base(L_IDS.acid, 'Acid-Kreischen', 'acid-line', '#a3e635', 'Lead'), {
    steps: 16,
    hits: 7,
    rotation: 1,
    gate: 0.6,
    accent: 0.4,
  });
  acid = voice(acid, {
    wave: 0.6,
    cutoff: 0.38,
    resonance: 0.85,
    envMod: 0.7,
    decay: 0.16,
    noteLength: 0.25,
    accent: 0.5,
    slide: 0.2,
    drive: 0.85,
    octaveShift: 1,
    melodyPattern: 1,
    melodyRange: 0.3,
    melodyLength: 7,
    melodySeed: 31,
    melodyLeap: 0.2,
    melodyChordTones: 0.4,
  });
  acid = chain(acid, {
    ...flatChain,
    'card-warmth-wavefold': { params: { warmthGrit: 0.35, wavefold: 0.12 } },
    'card-eq-orbit': { params: { lowDb: -8, midDb: 0, highDb: -1, stereoOrbit: 0.6 } },
    'card-tempo-echo': { bypassed: false, params: { mix: 0.2, division: 1, feedback: 0.35, darkening: 0.6, pingPong: 1 } },
  });
  acid = {
    ...acid,
    level: 0.35,
    modulations: [lfo('ht_mod_acid', 'Kreischen öffnet sich (16 Takte)', 'voice', 'voice', 'cutoff', 'ramp-up', 16, 0.18)],
  };

  // ein neuer Ton pro Takt (Euklid 1 aus 4 = Zählzeit 1)
  let reese = withEuclid(base(L_IDS.reese, 'Reese-Bass (Break)', 'reese-bass', '#a855f7', 'Bass'), {
    steps: 4,
    hits: 1,
    rotation: 0,
    gate: 1,
    accent: 0,
  });
  reese = voice(reese, {
    detune: 0.55,
    sub: 0.6,
    cutoff: 0.32,
    resonance: 0.3,
    filterEnv: 0.2,
    wobbleRate: 4,
    wobbleDepth: 0.45,
    drive: 0.5,
    distMode: 3,
    noteLength: 1,
    glide: 0.35,
    width: 0.45,
    octaveShift: 0,
    melodyPattern: 0,
  });
  reese = chain(reese, {
    ...flatChain,
    'card-eq-orbit': { params: { lowDb: 0, midDb: 0, highDb: -2, stereoOrbit: 0.8 } },
    'card-ducking-hall': { bypassed: false, params: { mix: 0.2, size: 0.7, decay: 0.6, brightness: 0.4, duckAmount: 0.3 } },
  });
  reese = {
    ...reese,
    level: 0.7,
    modulations: [lfo('ht_mod_reese', 'Reese öffnet sich (16 Takte)', 'voice', 'voice', 'cutoff', 'ramp-up', 16, 0.15)],
  };

  let riser = base(L_IDS.riser, 'Rausch-Riser (16 Takte)', 'noise-riser', '#64748b', 'FX', 16, 'bars');
  riser = { ...riser, timeOperators: updateOperator(riser.timeOperators, 'time-pulse-interference', { bypassed: true }) };
  riser = voice(riser, { direction: 0, sweepRange: 0.85, tension: 0.7, resonance: 0.55, toneMix: 0.1, pulseGate: 0, width: 0.9 });
  riser = chain(riser, { ...flatChain, 'card-tone-filter': { params: { brightness: 1, focus: 0.1, filterMode: 0, tilt: 0 } } });
  riser = { ...riser, level: 0.8 };

  return { kick, hats, openHat, clap, perc, fm, acid, reese, riser };
}

function snapshot(id: string, layers: LayerConfig[], progressionId: string): BeatSnapshot {
  return {
    id,
    tempoBpm: 150,
    timeSignature: { numerator: 4, denominator: 4 },
    masterGain: 0.88,
    masterGlue: 0.38,
    harmony: {
      rootNote: 5,
      scaleId: 'phrygian',
      chordPreset: 'minor',
      progressionId,
      progressionMode: 'preset',
      voiceLeadingEnabled: true,
    },
    curves: [],
    layers,
  };
}

const mute = (l: LayerConfig): LayerConfig => ({ ...l, muted: true });
const lvl = (l: LayerConfig, level: number): LayerConfig => ({ ...l, level });

export function createHardtechnoSections(): SectionItem[] {
  const L = buildLayers();
  const all = (o: Partial<HtLayers>): LayerConfig[] => {
    const m = { ...L, ...o };
    return [m.kick, m.hats, m.openHat, m.clap, m.perc, m.fm, m.acid, m.reese, m.riser];
  };
  const groove = all({ clap: mute(L.clap), perc: mute(L.perc), acid: mute(L.acid), reese: mute(L.reese), riser: mute(L.riser) });
  const peak = all({ reese: mute(L.reese), riser: mute(L.riser) });
  const brk = all({
    kick: mute(L.kick),
    hats: lvl(L.hats, 0.55),
    openHat: mute(L.openHat),
    fm: mute(L.fm),
    acid: mute(L.acid),
    perc: lvl(L.perc, 0.5),
  });
  const drop = all({
    acid: { ...voice(L.acid, { cutoff: 0.5, drive: 0.95, melodySeed: 57, melodyPattern: 11 }), level: 0.36 },
    fm: voice(L.fm, { melodyPattern: 1, distMode: 4, crush: 0.25 }),
    reese: mute(L.reese),
    riser: mute(L.riser),
  });
  const sec = (id: string, name: string, color: string, notes: string, layers: LayerConfig[], prog: string): SectionItem => ({
    id,
    name,
    color,
    notes,
    exportBars: 16,
    snapshot: snapshot(`snap_${id}`, layers, prog),
  });
  return [
    sec('ht_sec_groove', '01 Groove', '#64748b', 'Rumble-Kick, Hats & Offbeat-Bass', groove, 'static'),
    sec('ht_sec_peak', '02 Peak', '#ef4444', '+ Clap, Metall-Percussion & Acid-Kreischen', peak, 'phrygian_i_II'),
    sec('ht_sec_break', '03 Break', '#a855f7', 'Ohne Kick: Reese-Bass mit Wobble & Riser', brk, 'phrygian_i_II'),
    sec('ht_sec_drop', '04 Drop', '#f97316', 'Alles zurück, Bass als Oktav-Pendel & digital, Acid wilder', drop, 'phrygian_i_II'),
  ];
}

export function createHardtechnoProject(): ProjectDocument {
  const sections = createHardtechnoSections();
  const active = sections[1]!.snapshot;
  const history = createInitialHistory(active, 'Demo „Stahlwerk“ (Hardtechno) geladen');
  return {
    id: 'proj_stahlwerk',
    name: 'Stahlwerk',
    version: 1,
    updatedAt: Date.now(),
    activeSnapshot: active,
    activeHistoryNodeId: history.activeNodeId,
    historyNodes: history.nodes,
    sections,
  };
}
