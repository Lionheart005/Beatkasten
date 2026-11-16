import type { ParameterOption, ParameterSchema } from '../registry/types';

/**
 * Gemeinsamer Melodie-Generator für alle melodischen Voices (Glocke, Orgel, Acid-Linie).
 *
 * Alles ist eine pure Funktion von (Noten-Zähler, Einstellungen, Würfel-Seed):
 * keine Allokation, kein Zustand – dieselbe Einstellung erzeugt immer dieselbe Melodie
 * und wiederholt sich nach der Phrasen-Länge. Alte Muster-Indizes (0–4) bleiben in den
 * Voices selbst implementiert, die neuen Modi ab Index 5 kommen von hier.
 */

export const MELODY_MODE = {
  SCALE_DOWN: 5,
  SCALE_UP_DOWN: 6,
  ARP_UP: 7,
  ARP_DOWN: 8,
  ARP_PENDULUM: 9,
  RANDOM: 10,
  RANDOM_WALK: 11,
  MOTIF: 12,
  CALL_RESPONSE: 13,
} as const;

/** Neue, für alle melodischen Voices gemeinsame Modi (an die Legacy-Liste angehängt). */
export const EXTENDED_MELODY_OPTIONS: readonly ParameterOption[] = [
  { value: 5, label: 'Skala abwärts' },
  { value: 6, label: 'Skala auf & ab' },
  { value: 7, label: 'Akkord-Arpeggio aufwärts' },
  { value: 8, label: 'Akkord-Arpeggio abwärts' },
  { value: 9, label: 'Akkord-Arpeggio Pendel' },
  { value: 10, label: 'Zufall (Würfel)' },
  { value: 11, label: 'Zufalls-Spaziergang (Schritte)' },
  { value: 12, label: 'Motiv-Entwicklung (Umkehrung, Krebs)' },
  { value: 13, label: 'Ruf & Antwort' },
];

export const MELODY_MAX_MODE = 13;

export const MELODY_RATE_PARAM: ParameterSchema = {
  id: 'melodyRate',
  label: 'Melodie-Tempo',
  description:
    'Wie oft die Melodie zum nächsten Ton weiterspringt: bei jedem Schlag, jedem 2., 3. … Schlag. Die Schläge dazwischen wiederholen den Ton.',
  domain: 'harmony',
  min: 1,
  max: 8,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 1, label: 'Jeder Schlag' },
    { value: 2, label: 'Jeder 2. Schlag' },
    { value: 3, label: 'Jeder 3. Schlag' },
    { value: 4, label: 'Jeder 4. Schlag' },
    { value: 6, label: 'Jeder 6. Schlag' },
    { value: 8, label: 'Jeder 8. Schlag' },
  ],
};

export const MELODY_LENGTH_PARAM: ParameterSchema = {
  id: 'melodyLength',
  label: 'Phrasen-Länge',
  description:
    'Nach wie vielen Tönen die Melodie wieder von vorn beginnt (0 = Muster läuft frei durch). Kurze Phrasen = hypnotisch, lange = erzählend.',
  domain: 'harmony',
  min: 0,
  max: 16,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Frei' },
    { value: 2, label: '2 Töne' },
    { value: 3, label: '3 Töne' },
    { value: 4, label: '4 Töne' },
    { value: 5, label: '5 Töne' },
    { value: 6, label: '6 Töne' },
    { value: 7, label: '7 Töne' },
    { value: 8, label: '8 Töne' },
    { value: 12, label: '12 Töne' },
    { value: 16, label: '16 Töne' },
  ],
};

export const MELODY_SEED_PARAM: ParameterSchema = {
  id: 'melodySeed',
  label: 'Würfel (Variante)',
  description:
    'Wählt eine von 100 festen Varianten für Zufall, Spaziergang, Motiv, Sprünge und Pausen. Gleiche Zahl = immer gleiche Melodie.',
  domain: 'harmony',
  min: 0,
  max: 99,
  step: 1,
  defaultValue: 7,
  curve: 'linear',
  modulatable: false,
};

export const MELODY_LEAP_PARAM: ParameterSchema = {
  id: 'melodyLeap',
  label: 'Oktavsprünge',
  description: 'Wie oft einzelne Töne eine Oktave nach oben springen – typisch für Techno-Linien.',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

export const MELODY_CHORD_TONES_PARAM: ParameterSchema = {
  id: 'melodyChordTones',
  label: 'Akkordton-Bindung',
  description:
    '0 = Melodie läuft frei durch die Tonleiter, 1 = jeder Ton wird auf den nächsten Akkordton gezogen (klingt immer konsonant).',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

export const MELODY_REST_PARAM: ParameterSchema = {
  id: 'melodyRest',
  label: 'Pausen / Haltebögen',
  description:
    'Lässt einzelne Töne der Phrase aus (bzw. hält den vorigen Ton) – gibt der Melodie Luft zum Atmen.',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

/** Alle Zusatz-Regler, die jede melodische Voice übernimmt. */
export const MELODY_EXTRA_PARAMS: readonly ParameterSchema[] = [
  MELODY_RATE_PARAM,
  MELODY_LENGTH_PARAM,
  MELODY_SEED_PARAM,
  MELODY_LEAP_PARAM,
  MELODY_CHORD_TONES_PARAM,
  MELODY_REST_PARAM,
];

/** Deterministischer Hash → [0, 1). */
export function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export interface MelodyStepInfo {
  /** Melodie-Schritt nach Tempo-Teilung und Phrasen-Wiederholung. */
  step: number;
  /** Laufende Phrase (für Motiv-Variationen). */
  phrase: number;
  /** true, wenn dieser Schlag einen neuen Melodie-Ton beginnt (sonst Tonwiederholung). */
  isNewNote: boolean;
}

/** Wandelt den rohen Trigger-Zähler in Melodie-Schritt / Phrase um (zero alloc via out-Objekt). */
export function computeMelodyStep(
  counter: number,
  rate: number,
  length: number,
  mode: number,
  out: MelodyStepInfo,
): MelodyStepInfo {
  const r = Math.max(1, Math.round(rate));
  const raw = Math.floor(Math.max(0, counter) / r);
  let len = Math.round(length);
  // Zufallsmodi wiederholen sich standardmäßig nach 8 Tönen (sonst nie wiedererkennbar).
  if (len <= 0 && (mode === MELODY_MODE.RANDOM || mode === MELODY_MODE.RANDOM_WALK)) len = 8;
  if (len <= 0 && mode === MELODY_MODE.MOTIF) len = 16;
  if (len <= 0 && mode === MELODY_MODE.CALL_RESPONSE) len = 8;
  out.step = len > 0 ? raw % len : raw;
  out.phrase = len > 0 ? Math.floor(raw / len) : 0;
  out.isNewNote = counter % r === 0;
  return out;
}

const CALL_RESPONSE_VARIANTS: readonly (readonly number[])[] = [
  [0, 2, 4, 2, 4, 3, 1, 0],
  [0, 4, 3, 4, 2, 1, 2, 0],
  [2, 4, 5, 4, 3, 1, -1, 0],
];

/**
 * Liefert die Skalen-Stufe (Index in den gefalteten Tonvorrat) für einen der
 * erweiterten Modi (≥ 5). `chordDegs` = Stufen-Indizes der Akkordtöne (aufsteigend).
 */
export function extendedMelodyDegree(
  mode: number,
  step: number,
  phrase: number,
  range01: number,
  scaleLen: number,
  chordDegs: ArrayLike<number>,
  chordCount: number,
  seed: number,
): number {
  const len = Math.max(1, scaleLen);
  const octaveDegs = Math.max(1, Math.floor(len / 3));
  const span = Math.max(2, Math.min(len, Math.round(2 + range01 * octaveDegs * 1.6)));
  const s = seed | 0;

  switch (mode) {
    case MELODY_MODE.SCALE_DOWN:
      return span - 1 - (step % span);
    case MELODY_MODE.SCALE_UP_DOWN: {
      const period = 2 * (span - 1);
      const t = step % period;
      return t < span ? t : period - t;
    }
    case MELODY_MODE.ARP_UP:
    case MELODY_MODE.ARP_DOWN:
    case MELODY_MODE.ARP_PENDULUM: {
      if (chordCount <= 0) return (step * 2) % span;
      const arpLen = Math.max(
        2,
        Math.min(chordCount, Math.round(chordCount * (0.3 + 0.7 * range01))),
      );
      let idx: number;
      if (mode === MELODY_MODE.ARP_UP) idx = step % arpLen;
      else if (mode === MELODY_MODE.ARP_DOWN) idx = arpLen - 1 - (step % arpLen);
      else {
        const period = 2 * (arpLen - 1);
        const t = step % period;
        idx = t < arpLen ? t : period - t;
      }
      return chordDegs[idx] ?? 0;
    }
    case MELODY_MODE.RANDOM: {
      // Erster Ton jeder Phrase = Grundton (Orientierung), Rest gewürfelt.
      if (step === 0) return 0;
      return Math.floor(hash01(s, step, 101) * span);
    }
    case MELODY_MODE.RANDOM_WALK: {
      let pos = 0;
      for (let i = 1; i <= step; i++) {
        const h = hash01(s, i, 202);
        const move = h < 0.4 ? 1 : h < 0.8 ? -1 : h < 0.9 ? 2 : -2;
        pos += move;
        if (pos < 0) pos = -pos;
        if (pos > span - 1) pos = 2 * (span - 1) - pos;
        if (pos < 0) pos = 0;
      }
      return pos;
    }
    case MELODY_MODE.MOTIF: {
      // 4-Ton-Motiv aus dem Würfel, danach Transposition, Umkehrung, Krebs.
      const i = step % 4;
      const variation = Math.floor(step / 4) % 4;
      const motifSpan = Math.max(3, Math.min(span, 6));
      const noteAt = (k: number) => (k === 0 ? 0 : Math.floor(hash01(s, k, 303) * motifSpan));
      let deg: number;
      switch (variation) {
        case 1: // Sequenz eine Terz höher
          deg = noteAt(i) + 2;
          break;
        case 2: // Umkehrung (gespiegelt um den Startton)
          deg = 2 * 2 - noteAt(i);
          break;
        case 3: // Krebs (rückwärts)
          deg = noteAt(3 - i);
          break;
        default:
          deg = noteAt(i);
      }
      // jede zweite Phrase eine Stufe versetzt → längere Gesamtperiode
      if ((phrase & 1) === 1) deg += 1;
      return deg < 0 ? 0 : deg > len - 1 ? len - 1 : deg;
    }
    case MELODY_MODE.CALL_RESPONSE: {
      const variant = CALL_RESPONSE_VARIANTS[(s + phrase) % CALL_RESPONSE_VARIANTS.length]!;
      const deg = variant[step % 8]!;
      return deg < 0 ? 0 : deg > len - 1 ? len - 1 : deg;
    }
    default:
      return 0;
  }
}

/** Füllt `out` mit den Stufen-Indizes aller Töne im Tonvorrat, die Akkordtöne sind. */
export function fillChordDegrees(
  scaleBuf: ArrayLike<number>,
  scaleLen: number,
  chordNotes: readonly number[],
  out: Int8Array,
): number {
  let count = 0;
  if (chordNotes.length === 0) return 0;
  for (let d = 0; d < scaleLen && count < out.length; d++) {
    const pc = (((Math.round(scaleBuf[d]!) % 12) + 12) % 12) | 0;
    for (let c = 0; c < chordNotes.length; c++) {
      if ((((Math.round(chordNotes[c]!) % 12) + 12) % 12) === pc) {
        out[count++] = d;
        break;
      }
    }
  }
  return count;
}

/** Zieht eine Stufe auf den nächstgelegenen Akkordton (bei Gleichstand nach unten). */
export function snapToChordDegree(deg: number, chordDegs: ArrayLike<number>, chordCount: number): number {
  if (chordCount <= 0) return deg;
  let best = chordDegs[0]!;
  let bestDist = Math.abs(best - deg);
  for (let i = 1; i < chordCount; i++) {
    const d = chordDegs[i]!;
    const dist = Math.abs(d - deg);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Wendet Akkordton-Bindung, Oktavsprünge und Pausen auf eine Stufe an.
 * Ergebnis: Halbton-Versatz (Oktavsprung) im Rückgabewert, Stufe über `outDeg[0]`,
 * `NaN` = Pause.
 */
export function shapeMelodyNote(
  deg: number,
  step: number,
  seed: number,
  chordTones: number,
  leap: number,
  rest: number,
  chordDegs: ArrayLike<number>,
  chordCount: number,
  outDeg: Float64Array,
): number {
  const s = seed | 0;
  // Erster Ton der Phrase pausiert nie (Orientierung).
  if (rest > 0 && step > 0 && hash01(s, step, 404) < rest * 0.6) {
    outDeg[0] = deg;
    return Number.NaN;
  }
  let d = deg;
  if (chordTones > 0 && (chordTones >= 0.999 || hash01(s, step, 505) < chordTones)) {
    d = snapToChordDegree(d, chordDegs, chordCount);
  }
  outDeg[0] = d;
  if (leap > 0 && step > 0 && hash01(s, step, 606) < leap * 0.7) return 12;
  return 0;
}
