import type { ParamGroup, ParameterSchema, VoiceModule } from '../../registry/types';
import { PARAM_GROUP_ORDER } from '../../registry/types';
import { SUSTAIN_PARAM } from './voiceUtils';

/**
 * Einheitliche Ordnung der Klang-Regler aller Instrumente.
 *
 * Jede Zeile: [Parameter-ID, Gruppe, neue Bezeichnung?]. Die Reihenfolge der
 * Zeilen ist die Reihenfolge im Inspector (innerhalb der Gruppe). IDs bleiben
 * unverändert → gespeicherte Projekte bleiben kompatibel.
 *
 * Gemeinsames Vokabular:
 * - Tonhöhe:  Oktavlage · Stimmung (Halbtöne) · Gleiten
 * - Klangfarbe: Helligkeit · Resonanz · instrumenttypische Farbe
 * - Anschlag & Länge: Anschlag (…) · Länge (Ausklang) · Halten (Sustain) · Dauerton
 * - Verzerrung & Biss: Verzerrung · Verzerrungs-Art
 * - Stereo: Stereo-Breite
 * - Melodie & Tonfolge: Ton-Muster · Ton-Bewegung · Melodie-Tempo · …
 */
type LayoutRow = readonly [id: string, group: ParamGroup, label?: string];

const MELODY_ROWS: readonly LayoutRow[] = [
  ['melodyPattern', 'melody', 'Ton-Muster'],
  ['melodyRange', 'melody', 'Ton-Bewegung (Umfang)'],
  ['melodyRate', 'melody', 'Melodie-Tempo'],
  ['melodyLength', 'melody', 'Phrasen-Länge'],
  ['melodyLeap', 'melody', 'Oktavsprünge'],
  ['melodyChordTones', 'melody', 'Akkordton-Bindung'],
  ['melodyRest', 'melody', 'Pausen / Haltebögen'],
  ['melodySeed', 'melody', 'Würfel (Variante)'],
];

const SUSTAIN_ROW: LayoutRow = ['sustain', 'envelope'];

export const VOICE_PARAM_LAYOUT: Record<string, readonly LayoutRow[]> = {
  'pulse-texture': [
    ['pitchOffset', 'pitch', 'Stimmung (Halbtöne)'],
    ['bodyAir', 'tone', 'Körper ↔ Luft'],
    ['snap', 'envelope', 'Anschlag (Knack)'],
    ['punchDrop', 'envelope', 'Punch (Tonhöhen-Fall)'],
    ['decay', 'envelope', 'Länge (Ausklang)'],
    SUSTAIN_ROW,
    ['toneColor', 'drive', 'Wärme (Obertöne & Sättigung)'],
  ],
  'hard-kick': [
    ['tune', 'pitch', 'Stimmung (Halbtöne)'],
    ['pitchFollow', 'pitch', 'Tonhöhe folgt'],
    ['tone', 'tone', 'Helligkeit'],
    ['rumble', 'tone', 'Rumble (Grollen)'],
    ['rumbleLength', 'tone', 'Rumble-Länge'],
    ['rumbleGrit', 'tone', 'Rumble-Dreck'],
    ['rumbleDark', 'tone', 'Rumble-Dunkelheit'],
    ['click', 'envelope', 'Anschlag (Klick)'],
    ['punch', 'envelope', 'Punch (Tonhöhen-Fall)'],
    ['sweepTime', 'envelope', 'Fall-Geschwindigkeit'],
    ['decay', 'envelope', 'Länge (Ausklang)'],
    SUSTAIN_ROW,
    ['distortion', 'drive', 'Verzerrung'],
    ['distMode', 'drive', 'Verzerrungs-Art'],
  ],
  'metal-hat': [
    ['tune', 'pitch', 'Stimmung (Halbtöne)'],
    ['tone', 'tone', 'Helligkeit'],
    ['metalNoise', 'tone', 'Metall ↔ Rauschen'],
    ['dynamics', 'envelope', 'Dynamik (Akzente)'],
    ['openness', 'envelope', 'Länge (Öffnung)'],
    SUSTAIN_ROW,
    ['width', 'space', 'Stereo-Breite'],
  ],
  'clap-snare': [
    ['bodyTune', 'pitch', 'Stimmung (Fell, Halbtöne)'],
    ['clapSnare', 'tone', 'Clap ↔ Snare'],
    ['tone', 'tone', 'Helligkeit'],
    ['snappy', 'tone', 'Teppich (Rasseln)'],
    ['spread', 'envelope', 'Anschlag (Klatsch-Spreizung)'],
    ['decay', 'envelope', 'Länge (Ausklang)'],
    SUSTAIN_ROW,
    ['width', 'space', 'Stereo-Breite'],
  ],
  'sub-motion': [
    ['octaveShift', 'pitch', 'Oktavlage'],
    ['bassLine', 'pitch', 'Ton-Wahl'],
    ['glide', 'pitch', 'Gleiten'],
    ['subWarmth', 'tone', 'Sub-Wärme'],
    ['phaseBite', 'tone', 'Obertöne & Biss'],
    ['sustainHold', 'envelope', 'Halte-Energie'],
    ['drive', 'drive', 'Verzerrung'],
    ['autoDuck', 'motion', 'Beat-Ducking'],
  ],
  'acid-line': [
    ['octaveShift', 'pitch', 'Oktavlage'],
    ['slide', 'pitch', 'Gleiten (Slides)'],
    ['wave', 'tone', 'Säge ↔ Rechteck'],
    ['cutoff', 'tone', 'Helligkeit (Filter)'],
    ['resonance', 'tone', 'Resonanz (Quietschen)'],
    ['envMod', 'tone', 'Aufreißen pro Ton'],
    ['decay', 'tone', 'Filter-Ausklang'],
    ['accent', 'envelope', 'Akzente'],
    ['noteLength', 'envelope', 'Länge (Ausklang)'],
    SUSTAIN_ROW,
    ['drive', 'drive', 'Verzerrung'],
    ...MELODY_ROWS,
  ],
  'reese-bass': [
    ['octaveShift', 'pitch', 'Oktavlage'],
    ['glide', 'pitch', 'Gleiten'],
    ['detune', 'tone', 'Schwebung (Verstimmung)'],
    ['sub', 'tone', 'Sub-Fundament'],
    ['cutoff', 'tone', 'Helligkeit (Filter)'],
    ['resonance', 'tone', 'Resonanz'],
    ['filterEnv', 'tone', 'Aufreißen pro Ton'],
    ['noteLength', 'envelope', 'Länge (Ausklang)'],
    SUSTAIN_ROW,
    ['drive', 'drive', 'Verzerrung'],
    ['distMode', 'drive', 'Verzerrungs-Art'],
    ['wobbleRate', 'motion', 'Wobble-Tempo'],
    ['wobbleDepth', 'motion', 'Wobble-Tiefe'],
    ['width', 'space', 'Stereo-Breite'],
    ...MELODY_ROWS,
  ],
  'fm-bass': [
    ['octaveShift', 'pitch', 'Oktavlage'],
    ['pitchDrop', 'pitch', 'Tonhöhen-Fall'],
    ['fmRatio', 'tone', 'Metall-Farbe (Verhältnis)'],
    ['fmAmount', 'tone', 'Grund-Biss (FM-Stärke)'],
    ['feedback', 'tone', 'Knurren (Rückkopplung)'],
    ['tone', 'tone', 'Helligkeit'],
    ['sub', 'tone', 'Sub-Fundament'],
    ['bite', 'envelope', 'Anschlag (Biss)'],
    ['biteDecay', 'envelope', 'Biss-Länge'],
    ['noteLength', 'envelope', 'Länge (Ausklang)'],
    SUSTAIN_ROW,
    ['drive', 'drive', 'Verzerrung'],
    ['distMode', 'drive', 'Verzerrungs-Art'],
    ['crush', 'drive', 'Digital-Raster'],
    ...MELODY_ROWS,
  ],
  'chord-arp': [
    ['octaveSpread', 'pitch', 'Oktav-Weite'],
    ['timbreShape', 'tone', 'Klang-Fülle'],
    ['softness', 'envelope', 'Weichheit (Ein-/Ausblenden)'],
    ['droneHold', 'envelope', 'Dauerton (ignoriert Rhythmus)'],
    ['detuneShimmer', 'space', 'Breite & Schwebung'],
    ['chordArpMorph', 'melody', 'Akkord ↔ Arpeggio'],
    ['arpPattern', 'melody', 'Arpeggio-Muster'],
    ['arpSpeed', 'melody', 'Arpeggio-Tempo'],
    ['arpGrid', 'melody', 'Arpeggio-Raster'],
  ],
  'modal-bell': [
    ['octaveShift', 'pitch', 'Oktavlage'],
    ['material', 'tone', 'Material (Holz ↔ Metall)'],
    ['shimmer', 'tone', 'Schimmer'],
    ['malletHardness', 'envelope', 'Anschlag (Hammer-Härte)'],
    ['decay', 'envelope', 'Länge (Ausklang)'],
    SUSTAIN_ROW,
    ...MELODY_ROWS,
  ],
  'pipe-organ': [
    ['octaveShift', 'pitch', 'Oktavlage'],
    ['voiceMode', 'pitch', 'Stimm-Modus'],
    ['register', 'tone', 'Register (Flöte ↔ Mixtur)'],
    ['chiff', 'envelope', 'Anschlag (Anblas-Chiff)'],
    ['release', 'envelope', 'Länge (Ausklang)'],
    ['droneHold', 'envelope', 'Dauerton (ignoriert Rhythmus)'],
    ['tremolo', 'motion', 'Tremolo (Tremulant)'],
    ...MELODY_ROWS,
  ],
  'noise-riser': [
    ['toneMix', 'tone', 'Ton im Rauschen'],
    ['resonance', 'tone', 'Resonanz (Pfeifen)'],
    ['direction', 'motion', 'Richtung'],
    ['sweepRange', 'motion', 'Weg der Welle'],
    ['tension', 'motion', 'Spannungskurve'],
    ['pulseGate', 'motion', 'Rhythmisches Zerhacken'],
    ['width', 'space', 'Stereo-Breite'],
  ],
};

/**
 * Ordnet die Parameter eines Instruments nach {@link VOICE_PARAM_LAYOUT}:
 * Gruppe + einheitliche Bezeichnung, feste Reihenfolge, gemeinsamer
 * „Halten“-Regler. Nicht gelistete Parameter landen unter „Klangfarbe“.
 */
export function applyParamLayout(mod: VoiceModule): VoiceModule {
  const rows = VOICE_PARAM_LAYOUT[mod.id];
  if (!rows) return mod;
  const byId = new Map<string, ParameterSchema>(mod.parameters.map((p) => [p.id, p]));
  byId.set(SUSTAIN_PARAM.id, byId.get(SUSTAIN_PARAM.id) ?? SUSTAIN_PARAM);
  const out: ParameterSchema[] = [];
  const used = new Set<string>();
  for (const [id, group, label] of rows) {
    const p = byId.get(id);
    if (!p || used.has(id)) continue;
    used.add(id);
    out.push({ ...p, group, ...(label ? { label } : {}) });
  }
  for (const p of mod.parameters) {
    if (!used.has(p.id)) out.push({ ...p, group: p.group ?? 'tone' });
  }
  const rank = (g: ParamGroup | undefined) => PARAM_GROUP_ORDER.indexOf(g ?? 'tone');
  out.sort((a, b) => rank(a.group) - rank(b.group));
  return { ...mod, parameters: out };
}
