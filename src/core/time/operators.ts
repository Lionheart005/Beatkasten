import {
  gridGravityPull,
  interferenceEnergy,
  interferenceSlope,
  phaseDriftOffset,
  warpPhase,
  wrapPhase01,
} from '../math';
import {
  type MutableTimeFrame,
  type ParameterSchema,
  type TimeEvalContext,
  type TimeFrame,
  type TimeOperatorModule,
} from '../registry/types';

function readParam(schema: ParameterSchema, params: Record<string, number>): number {
  const raw = params[schema.id];
  const val = raw === undefined || !Number.isFinite(raw) ? schema.defaultValue : raw;
  const clamped = val < schema.min ? schema.min : val > schema.max ? schema.max : val;
  if (schema.step !== undefined && schema.step > 0) {
    const snapped = Math.round((clamped - schema.min) / schema.step) * schema.step + schema.min;
    return snapped < schema.min ? schema.min : snapped > schema.max ? schema.max : snapped;
  }
  return clamped;
}

const WARP_AMOUNT_PARAM: ParameterSchema = {
  id: 'warpAmount',
  label: 'Zeit-Krümmung',
  description: 'Staucht oder dehnt den Verlauf eines Taktes nach vorn oder hinten.',
  domain: 'time',
  min: -1,
  max: 1,
  defaultValue: 0,
  curve: 'bipolar',
  modulatable: true,
};

export const timeWarpOperator: TimeOperatorModule = {
  id: 'time-warp',
  version: 1,
  displayName: 'Zeit-Krümmung',
  description: 'Verbiegt die Zeitkurve innerhalb des Zyklus für schiebende oder ziehende Grooves.',
  parameters: [WARP_AMOUNT_PARAM],
  evaluateTimeInto(
    _ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const warpAmount = readParam(WARP_AMOUNT_PARAM, params);
    outFrame.warpedPhase = warpPhase(prevFrame.warpedPhase, warpAmount);
    outFrame.pulseEnergy = prevFrame.pulseEnergy;
    outFrame.triggerIntensity = prevFrame.triggerIntensity;
    outFrame.accent = prevFrame.accent;
    outFrame.stepIndex = prevFrame.stepIndex;
    outFrame.pulseSlope = prevFrame.pulseSlope ?? 0;
  },
  evaluateTime(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
  ): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

const SUBDIVISIONS_PARAM: ParameterSchema = {
  id: 'subdivisions',
  label: 'Raster-Teilung',
  description: 'Anzahl der rhythmischen Anziehungspunkte pro Zyklus.',
  domain: 'time',
  min: 1,
  max: 64,
  step: 1,
  defaultValue: 4,
  curve: 'linear',
  modulatable: false,
};

const PHASE_SHIFT_PARAM: ParameterSchema = {
  id: 'phaseShift',
  label: 'Raster-Versatz',
  description: '0 = Downbeat, 0.5 = Offbeat-Sog',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const GRAVITY_PARAM: ParameterSchema = {
  id: 'gravity',
  label: 'Gravitation',
  description: 'Wie stark die Zeit auf die gewählten Rasterpunkte hingezogen wird.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

export const timeGridGravityOperator: TimeOperatorModule = {
  id: 'time-grid-gravity',
  version: 1,
  displayName: 'Raster-Gravitation',
  description: 'Zieht den Puls sanft an Downbeats, Offbeats oder Triolen-Punkte.',
  parameters: [SUBDIVISIONS_PARAM, PHASE_SHIFT_PARAM, GRAVITY_PARAM],
  evaluateTimeInto(
    _ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const subdivisions = Math.round(readParam(SUBDIVISIONS_PARAM, params));
    const phaseShift = readParam(PHASE_SHIFT_PARAM, params);
    const gravity = readParam(GRAVITY_PARAM, params);

    outFrame.warpedPhase = gridGravityPull(
      prevFrame.warpedPhase,
      subdivisions,
      phaseShift,
      gravity,
    );
    outFrame.pulseEnergy = prevFrame.pulseEnergy;
    outFrame.triggerIntensity = prevFrame.triggerIntensity;
    outFrame.accent = prevFrame.accent;
    outFrame.stepIndex = prevFrame.stepIndex;
    outFrame.pulseSlope = prevFrame.pulseSlope ?? 0;
  },
  evaluateTime(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
  ): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

const DRIFT_STEPS_PARAM: ParameterSchema = {
  id: 'driftSteps',
  label: 'Drift pro Zyklus',
  description: 'Verschiebt den Startpunkt bei jedem Durchlauf leicht vor oder zurück.',
  domain: 'time',
  min: -0.5,
  max: 0.5,
  defaultValue: 0,
  curve: 'bipolar',
  modulatable: false,
};

const RESET_CYCLES_PARAM: ParameterSchema = {
  id: 'resetCycles',
  label: 'Neustart-Zyklen',
  description: 'Nach wie vielen Zyklen sich das Muster wieder auf den Anfang ausrichtet.',
  domain: 'time',
  min: 1,
  max: 32,
  step: 1,
  defaultValue: 8,
  curve: 'linear',
  modulatable: false,
};

export const timePhaseDriftOperator: TimeOperatorModule = {
  id: 'time-phase-drift',
  version: 1,
  displayName: 'Kaleidoskop-Drift',
  description: 'Lässt Rhythmen zyklisch gegeneinander wandern und regelmäßig einrasten.',
  parameters: [DRIFT_STEPS_PARAM, RESET_CYCLES_PARAM],
  evaluateTimeInto(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const driftSteps = readParam(DRIFT_STEPS_PARAM, params);
    const resetCycles = Math.round(readParam(RESET_CYCLES_PARAM, params));
    const offset = phaseDriftOffset(ctx.cycleIndex, driftSteps, resetCycles);
    outFrame.warpedPhase = wrapPhase01(prevFrame.warpedPhase + offset);
    outFrame.pulseEnergy = prevFrame.pulseEnergy;
    outFrame.triggerIntensity = prevFrame.triggerIntensity;
    outFrame.accent = prevFrame.accent;
    outFrame.stepIndex = prevFrame.stepIndex;
    outFrame.pulseSlope = prevFrame.pulseSlope ?? 0;
  },
  evaluateTime(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
  ): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

const FREQ_A_PARAM: ParameterSchema = {
  id: 'freqA',
  label: 'Puls-Welle A',
  description: 'Grundpuls-Anzahl pro Zyklus für die erste rhythmische Welle.',
  domain: 'time',
  min: 1,
  max: 64,
  step: 1,
  defaultValue: 4,
  curve: 'linear',
  modulatable: false,
};

const FREQ_B_PARAM: ParameterSchema = {
  id: 'freqB',
  label: 'Puls-Welle B',
  description: 'Gegenwelle für polymetrische Betonungen und lebendige Akzente.',
  domain: 'time',
  min: 1,
  max: 64,
  step: 1,
  defaultValue: 4,
  curve: 'linear',
  modulatable: false,
};

const INTERFERENCE_MIX_PARAM: ParameterSchema = {
  id: 'interferenceMix',
  label: 'Welle B Anteil',
  description: '0 = Welle B aus (absolut gerader Grundpuls A), > 0 = mischt Gegenwelle B ein.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const PHASE_OFFSET_PARAM: ParameterSchema = {
  id: 'phaseOffset',
  label: 'Versatz Welle B',
  description: 'Verschiebt die zweite Welle zeitlich für synkopierte Akzente.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const THRESHOLD_PARAM: ParameterSchema = {
  id: 'threshold',
  label: 'Auslöse-Schwelle',
  description: '0 = alle Wellen-Gipfel lösen aus; höhere Werte filtern leise Nebenimpulse heraus.',
  domain: 'time',
  min: 0,
  max: 0.92,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const WAVE_SHAPE_PARAM: ParameterSchema = {
  id: 'waveShape',
  label: 'Wellen-Schärfe',
  description:
    '-1 = schmale steile Spitzen, 0 = weiche Kosinus-Welle, +1 = hart Ein/Aus (Rechteck-Gate) ohne Taktversatz.',
  domain: 'time',
  min: -1,
  max: 1,
  defaultValue: 0,
  curve: 'bipolar',
  modulatable: true,
};

export const timePulseInterferenceOperator: TimeOperatorModule = {
  id: 'time-pulse-interference',
  version: 1,
  displayName: 'Puls-Interferenz',
  description: 'Erzeugt aus zwei überlagerten Wellen rhythmische Energie, Akzente und Trigger.',
  parameters: [
    FREQ_A_PARAM,
    FREQ_B_PARAM,
    INTERFERENCE_MIX_PARAM,
    PHASE_OFFSET_PARAM,
    THRESHOLD_PARAM,
    WAVE_SHAPE_PARAM,
  ],
  evaluateTimeInto(
    _ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const freqA = Math.max(1, Math.round(readParam(FREQ_A_PARAM, params)));
    const freqB = Math.max(1, Math.round(readParam(FREQ_B_PARAM, params)));
    const mix = readParam(INTERFERENCE_MIX_PARAM, params);
    const phaseOffset = readParam(PHASE_OFFSET_PARAM, params);
    const threshold = readParam(THRESHOLD_PARAM, params);
    const waveShape = readParam(WAVE_SHAPE_PARAM, params);

    const p = wrapPhase01(prevFrame.warpedPhase);
    const pulseEnergy = interferenceEnergy(
      p,
      freqA,
      freqB,
      mix,
      phaseOffset,
      threshold,
      waveShape,
    );
    const stepIndex = Math.floor(p * freqA);
    const currSlope = interferenceSlope(p, freqA, freqB, mix, phaseOffset);
    const rawAccent = pulseEnergy * (1 - 0.3 * Math.abs(Math.sin(Math.PI * p)));
    const accent = rawAccent < 0 ? 0 : rawAccent > 1 ? 1 : rawAccent;

    let triggerIntensity = 0;
    if (mix <= 0.0001) {
      // Pure Wave A: exact cosine peaks sit at p = k / freqA where stepIndex advances.
      if (stepIndex !== prevFrame.stepIndex && pulseEnergy > 0.01) {
        triggerIntensity = pulseEnergy;
      }
    } else {
      // Interference active: trigger at local wave crests (slope crossing + -> -) above threshold.
      const prevSlope =
        prevFrame.stepIndex < 0
          ? interferenceSlope(
              wrapPhase01(p - 0.002),
              freqA,
              freqB,
              mix,
              phaseOffset,
            )
          : (prevFrame.pulseSlope ?? 0);
      if (prevSlope > 1e-9 && currSlope <= 1e-9 && pulseEnergy > 0.02) {
        triggerIntensity = pulseEnergy;
      }
    }

    outFrame.warpedPhase = p;
    outFrame.pulseEnergy = pulseEnergy;
    outFrame.triggerIntensity = triggerIntensity;
    outFrame.accent = accent;
    outFrame.stepIndex = stepIndex;
    outFrame.pulseSlope = currSlope;
  },
  evaluateTime(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
  ): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

// ---------------------------------------------------------------------------
// Euklidischer Rhythmus: k Schläge so gleichmäßig wie möglich auf n Steps
// ---------------------------------------------------------------------------

const EUCLID_MAX_STEPS = 32;

/** Bjorklund's algorithm: canonical euclidean rhythm (e.g. 5/8 -> x.xx.xx.). */
function bjorklund(hits: number, steps: number): number[] {
  if (hits <= 0) return new Array<number>(steps).fill(0);
  if (hits >= steps) return new Array<number>(steps).fill(1);
  let a: number[][] = Array.from({ length: hits }, () => [1]);
  let b: number[][] = Array.from({ length: steps - hits }, () => [0]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const merged: number[][] = [];
    for (let i = 0; i < m; i++) merged.push([...a[i]!, ...b[i]!]);
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = merged;
    b = rest;
  }
  return [...a.flat(), ...b.flat()];
}

// Pre-computed tables (built once at module load, zero allocation in the audio path):
// EUCLID_ORDINAL[n][k][i] = index of the hit at step i (0 = first hit), or -1 for a rest.
const EUCLID_ORDINAL: Int8Array[][] = [];
for (let n = 0; n <= EUCLID_MAX_STEPS; n++) {
  const row: Int8Array[] = [];
  for (let k = 0; k <= n; k++) {
    const pattern = n > 0 ? bjorklund(k, n) : [];
    const ord = new Int8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) ord[i] = pattern[i] ? count++ : -1;
    row.push(ord);
  }
  EUCLID_ORDINAL.push(row);
}

/** Hit ordinal of (unrotated) step `i` in a euclidean (k, n) rhythm, -1 = rest. */
export function euclidHitOrdinal(i: number, hits: number, steps: number): number {
  const n = Math.max(1, Math.min(EUCLID_MAX_STEPS, steps | 0));
  const k = Math.max(0, Math.min(n, hits | 0));
  return EUCLID_ORDINAL[n]![k]![((i % n) + n) % n]!;
}

/** True if (unrotated) step `i` of an euclidean (k, n) rhythm is a hit. */
export function isEuclidHit(i: number, hits: number, steps: number): boolean {
  return euclidHitOrdinal(i, hits, steps) >= 0;
}

/** Full pattern incl. rotation (later = positive rotation). For UI previews. */
export function euclidPattern(steps: number, hits: number, rotation: number): boolean[] {
  const n = Math.max(1, Math.round(steps));
  const k = Math.max(0, Math.min(n, Math.round(hits)));
  const rot = ((Math.round(rotation) % n) + n) % n;
  const out: boolean[] = [];
  for (let s = 0; s < n; s++) out.push(isEuclidHit((s - rot + n) % n, k, n));
  return out;
}

const EUCLID_STEPS_PARAM: ParameterSchema = {
  id: 'euclidSteps',
  label: 'Steps (Raster)',
  description:
    'In wie viele gleich lange Schritte der Layer-Zyklus geteilt wird (z. B. 16 = Sechzehntel bei 4 Beats).',
  domain: 'time',
  min: 1,
  max: 32,
  step: 1,
  defaultValue: 16,
  curve: 'linear',
  modulatable: false,
};

const EUCLID_HITS_PARAM: ParameterSchema = {
  id: 'euclidHits',
  label: 'Schläge',
  description:
    'Wie viele Schläge möglichst gleichmäßig auf die Steps verteilt werden (3 auf 8 = Tresillo, 5 auf 8 = Cinquillo). Bewegbar für wachsende Dichte.',
  domain: 'time',
  min: 0,
  max: 32,
  step: 1,
  defaultValue: 5,
  curve: 'linear',
  modulatable: true,
};

const EUCLID_ROTATION_PARAM: ParameterSchema = {
  id: 'euclidRotation',
  label: 'Verschiebung',
  description: 'Rotiert das Muster um ganze Steps nach hinten – gleiche Verteilung, anderer Groove.',
  domain: 'time',
  min: 0,
  max: 31,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const EUCLID_GATE_PARAM: ParameterSchema = {
  id: 'euclidGate',
  label: 'Ton-Länge',
  description: 'Wie lange jeder Schlag innerhalb seines Steps klingt (kurz = staccato, 1 = ganzer Step).',
  domain: 'time',
  min: 0.05,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const EUCLID_ACCENT_PARAM: ParameterSchema = {
  id: 'euclidAccent',
  label: 'Akzent auf dem ersten Schlag',
  description: '0 = alle Schläge gleich laut, 1 = der erste Schlag des Musters deutlich betont.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const EUCLID_MODE_PARAM: ParameterSchema = {
  id: 'euclidMode',
  label: 'Modus',
  description:
    'Eigener Puls = erzeugt den Rhythmus selbst. Maske = lässt nur die Pulse der Puls-Interferenz durch, die auf einen Schlag fallen.',
  domain: 'time',
  min: 0,
  max: 1,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Eigener Puls' },
    { value: 1, label: 'Maske über Puls-Interferenz' },
  ],
};

export const timeEuclidOperator: TimeOperatorModule = {
  id: 'time-euclid',
  version: 1,
  displayName: 'Euklidischer Rhythmus',
  description:
    'Verteilt k Schläge möglichst gleichmäßig auf n Steps des Zyklus – die Formel hinter vielen Welt-Rhythmen (Tresillo, Clave, Bossa).',
  parameters: [
    EUCLID_STEPS_PARAM,
    EUCLID_HITS_PARAM,
    EUCLID_ROTATION_PARAM,
    EUCLID_GATE_PARAM,
    EUCLID_ACCENT_PARAM,
    EUCLID_MODE_PARAM,
  ],
  evaluateTimeInto(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const n = Math.max(1, Math.round(readParam(EUCLID_STEPS_PARAM, params)));
    const k = Math.max(0, Math.min(n, Math.round(readParam(EUCLID_HITS_PARAM, params))));
    const rot = ((Math.round(readParam(EUCLID_ROTATION_PARAM, params)) % n) + n) % n;
    const gate = readParam(EUCLID_GATE_PARAM, params);
    const accentAmt = readParam(EUCLID_ACCENT_PARAM, params);
    const maskMode = Math.round(readParam(EUCLID_MODE_PARAM, params)) === 1;

    const p = wrapPhase01(prevFrame.warpedPhase);
    const pos = p * n;
    let step = Math.floor(pos);
    if (step >= n) step = n - 1;
    const frac = pos - step;
    const src = (step - rot + n) % n;
    // Ordinal of this hit inside the pattern (0 = first hit of the cycle, -1 = rest).
    const ordinal = euclidHitOrdinal(src, k, n);
    const hit = ordinal >= 0;
    const velocity = hit ? (ordinal === 0 ? 1 : 1 - 0.45 * accentAmt) : 0;
    const inGate = hit && frac < gate;

    // Step-change detection uses the engine-owned slot memory (operators are shared).
    const state = ctx.slotState;
    const prevStep = state ? state[0]! : prevFrame.stepIndex;
    const isNewStep = step !== prevStep;
    if (state) state[0] = step;

    outFrame.warpedPhase = p;
    if (maskMode && ctx.hasPulseSource) {
      outFrame.pulseEnergy = inGate ? prevFrame.pulseEnergy * velocity : 0;
      outFrame.triggerIntensity = hit ? prevFrame.triggerIntensity * velocity : 0;
      outFrame.accent = hit ? prevFrame.accent * velocity : 0;
      outFrame.stepIndex = prevFrame.stepIndex;
      outFrame.pulseSlope = prevFrame.pulseSlope ?? 0;
      return;
    }

    outFrame.pulseEnergy = inGate ? velocity * (1 - 0.3 * (frac / gate)) : 0;
    outFrame.triggerIntensity = hit && isNewStep ? velocity : 0;
    outFrame.accent = velocity;
    outFrame.stepIndex = step;
    outFrame.pulseSlope = inGate ? -0.3 / gate : 0;
  },
  evaluateTime(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
  ): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

// ---------------------------------------------------------------------------
// Swing / Shuffle: verschiebt jeden zweiten Raster-Schritt nach hinten
// (Phasen-Warp – muss VOR Puls-Interferenz / Euklid stehen)
// ---------------------------------------------------------------------------

const SWING_AMOUNT_PARAM: ParameterSchema = {
  id: 'swingAmount',
  label: 'Swing',
  description:
    'Wie stark jeder zweite Schritt verzögert wird: 0 = gerade (maschinell), 0.33 ≈ Triolen-Shuffle, darüber = stark „hinkend“.',
  domain: 'time',
  min: 0,
  max: 0.7,
  defaultValue: 0.2,
  curve: 'linear',
  modulatable: true,
};

const SWING_GRID_PARAM: ParameterSchema = {
  id: 'swingGrid',
  label: 'Swing-Raster',
  description: 'Auf welchen Notenwert der Swing wirkt (meist 1/16 in Techno & House).',
  domain: 'time',
  min: 1,
  max: 8,
  step: 1,
  defaultValue: 4,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 1, label: '1/4' },
    { value: 2, label: '1/8' },
    { value: 4, label: '1/16' },
    { value: 8, label: '1/32' },
  ],
};

/** Swing-Warp für eine Position u (in Raster-Schritten); Schrittpaare [2k, 2k+2). */
export function swingWarpSteps(u: number, swing: number): number {
  const pair = Math.floor(u / 2);
  const local = u - pair * 2;
  const split = 1 + swing;
  // Ausgabe-Schritt 1 (der „und“-Schlag) beginnt erst bei local = 1 + swing.
  const out = local < split ? local / split : 1 + (local - split) / (2 - split);
  return pair * 2 + out;
}

export const timeSwingOperator: TimeOperatorModule = {
  id: 'time-swing',
  version: 1,
  displayName: 'Swing & Shuffle',
  description:
    'Verzögert jeden zweiten Schritt des Rasters – aus starren 16teln wird ein federnder Groove. Steht vor der Puls-Erzeugung.',
  parameters: [SWING_AMOUNT_PARAM, SWING_GRID_PARAM],
  evaluateTimeInto(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const swing = readParam(SWING_AMOUNT_PARAM, params);
    const perBeat = Math.max(1, Math.round(readParam(SWING_GRID_PARAM, params)));
    const p = wrapPhase01(prevFrame.warpedPhase);
    const steps = Math.max(2, Math.round(ctx.cycleBeats * perBeat));
    let warped = p;
    if (swing > 1e-4 && steps % 2 === 0) {
      warped = swingWarpSteps(p * steps, swing) / steps;
      if (warped >= 1) warped -= 1;
    }
    outFrame.warpedPhase = warped;
    outFrame.pulseEnergy = prevFrame.pulseEnergy;
    outFrame.triggerIntensity = prevFrame.triggerIntensity;
    outFrame.accent = prevFrame.accent;
    outFrame.stepIndex = prevFrame.stepIndex;
    outFrame.pulseSlope = prevFrame.pulseSlope ?? 0;
  },
  evaluateTime(ctx: TimeEvalContext, params: Record<string, number>, prevFrame: TimeFrame): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

// ---------------------------------------------------------------------------
// Zufall & Ghost-Notes: gewürfelte (aber wiederholbare) Auslassungen und Dynamik
// (Maske – muss NACH Puls-Interferenz / Euklid stehen)
// ---------------------------------------------------------------------------

const CHANCE_PARAM: ParameterSchema = {
  id: 'chance',
  label: 'Wahrscheinlichkeit',
  description: 'Wie viele Schläge tatsächlich gespielt werden (1 = alle, 0.5 = etwa jeder zweite – gewürfelt).',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.8,
  curve: 'linear',
  modulatable: true,
};

const GHOST_PARAM: ParameterSchema = {
  id: 'ghost',
  label: 'Ghost-Notes statt Pausen',
  description: '0 = ausgewürfelte Schläge fallen weg, 1 = sie werden ganz leise als „Geisternoten“ gespielt.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const HUMANIZE_PARAM: ParameterSchema = {
  id: 'humanize',
  label: 'Lebendige Dynamik',
  description: 'Leichte, zufällige Lautstärke-Schwankung jedes Schlags – wie von Hand gespielt.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.3,
  curve: 'linear',
  modulatable: true,
};

const CHANCE_SEED_PARAM: ParameterSchema = {
  id: 'chanceSeed',
  label: 'Würfel (Variante)',
  description: 'Andere Zahl = anderes Zufallsmuster. Gleiche Zahl = exakt gleiches Muster.',
  domain: 'time',
  min: 0,
  max: 99,
  step: 1,
  defaultValue: 3,
  curve: 'linear',
  modulatable: false,
};

const CHANCE_LOOP_PARAM: ParameterSchema = {
  id: 'chanceLoop',
  label: 'Muster wiederholt sich nach',
  description: 'Nach wie vielen Layer-Zyklen das gewürfelte Muster wieder von vorn beginnt (wiedererkennbar statt chaotisch).',
  domain: 'time',
  min: 1,
  max: 16,
  step: 1,
  defaultValue: 2,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 1, label: '1 Zyklus' },
    { value: 2, label: '2 Zyklen' },
    { value: 4, label: '4 Zyklen' },
    { value: 8, label: '8 Zyklen' },
    { value: 16, label: '16 Zyklen' },
  ],
};

const CHANCE_PROTECT_PARAM: ParameterSchema = {
  id: 'protectDownbeat',
  label: 'Eins schützen',
  description: 'Der erste Schlag jedes Zyklus wird immer voll gespielt (hält den Groove zusammen).',
  domain: 'time',
  min: 0,
  max: 1,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Aus' },
    { value: 1, label: 'An' },
  ],
};

function chanceHash(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const timeChanceOperator: TimeOperatorModule = {
  id: 'time-chance',
  version: 1,
  displayName: 'Zufall & Ghost-Notes',
  description:
    'Würfelt pro Schlag, ob er gespielt, leise (Ghost-Note) oder ausgelassen wird – wiederholbar nach N Zyklen. Steht hinter der Puls-Erzeugung.',
  parameters: [CHANCE_PARAM, GHOST_PARAM, HUMANIZE_PARAM, CHANCE_SEED_PARAM, CHANCE_LOOP_PARAM, CHANCE_PROTECT_PARAM],
  evaluateTimeInto(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const chance = readParam(CHANCE_PARAM, params);
    const ghost = readParam(GHOST_PARAM, params);
    const humanize = readParam(HUMANIZE_PARAM, params);
    const seed = readParam(CHANCE_SEED_PARAM, params) | 0;
    const loop = Math.max(1, Math.round(readParam(CHANCE_LOOP_PARAM, params)));
    const protect = Math.round(readParam(CHANCE_PROTECT_PARAM, params)) === 1;

    const state = ctx.slotState;
    const p = wrapPhase01(prevFrame.warpedPhase);
    let gain = state && Number.isFinite(state[0]!) ? state[0]! : 1;
    if (prevFrame.triggerIntensity > 0.01) {
      // Schritt-Identität: 1/64-Position im Zyklus + Zyklus im Wiederholungsfenster
      const pos = Math.floor(p * Math.max(1, ctx.cycleBeats) * 16 + 1e-6);
      const cyc = ((ctx.cycleIndex % loop) + loop) % loop;
      const isDownbeat = pos === 0;
      const r = chanceHash(seed, pos, cyc);
      if (protect && isDownbeat) gain = 1;
      else if (r < chance) gain = 1;
      else gain = ghost * 0.32;
      if (gain > 0 && humanize > 0) {
        const h = chanceHash(seed + 17, pos, cyc);
        gain *= 1 - humanize * 0.45 * h;
      }
      if (state) state[0] = gain;
    }
    outFrame.warpedPhase = prevFrame.warpedPhase;
    outFrame.pulseEnergy = prevFrame.pulseEnergy * gain;
    outFrame.triggerIntensity = gain > 0.001 ? prevFrame.triggerIntensity * gain : 0;
    outFrame.accent = prevFrame.accent * (gain > 0 ? 0.6 + 0.4 * gain : 0);
    outFrame.stepIndex = prevFrame.stepIndex;
    outFrame.pulseSlope = prevFrame.pulseSlope ?? 0;
  },
  evaluateTime(ctx: TimeEvalContext, params: Record<string, number>, prevFrame: TimeFrame): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

export const TIME_OPERATORS: readonly TimeOperatorModule[] = [
  timeWarpOperator,
  timeGridGravityOperator,
  timePhaseDriftOperator,
  timeSwingOperator,
  timePulseInterferenceOperator,
  timeEuclidOperator,
  timeChanceOperator,
];
