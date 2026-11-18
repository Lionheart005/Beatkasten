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
    outFrame.gate = prevFrame.gate ?? 0;
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
      gate: 0,
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
    outFrame.gate = prevFrame.gate ?? 0;
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
      gate: 0,
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
    outFrame.gate = prevFrame.gate ?? 0;
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
      gate: 0,
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
    outFrame.gate = pulseEnergy > 0.05 ? 1 : 0;
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
      gate: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

// ---------------------------------------------------------------------------
// Euklidischer Rhythmus: k Schläge so gleichmäßig wie möglich auf n Steps
// ---------------------------------------------------------------------------

const EUCLID_MAX_STEPS = 64;

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
      outFrame.gate = inGate ? (prevFrame.gate ?? 0) : 0;
      return;
    }

    outFrame.pulseEnergy = inGate ? velocity * (1 - 0.3 * (frac / gate)) : 0;
    outFrame.triggerIntensity = hit && isNewStep ? velocity : 0;
    outFrame.accent = velocity;
    outFrame.stepIndex = step;
    outFrame.pulseSlope = inGate ? -0.3 / gate : 0;
    outFrame.gate = inGate ? 1 : 0;
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
      gate: 0,
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
    outFrame.gate = prevFrame.gate ?? 0;
  },
  evaluateTime(ctx: TimeEvalContext, params: Record<string, number>, prevFrame: TimeFrame): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
      gate: 0,
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
    outFrame.gate = gain > 0.001 ? (prevFrame.gate ?? 0) : 0;
  },
  evaluateTime(ctx: TimeEvalContext, params: Record<string, number>, prevFrame: TimeFrame): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
      gate: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

// ---------------------------------------------------------------------------
// Rhythmus-Raster: n Steps, Schläge per Klick (Bitmasken), Akzente, Haltebögen
// und eine einstellbare Hüllkurve (Spitze / Ton-Länge / Ausklang).
// ---------------------------------------------------------------------------

export const GRID_MAX_STEPS = 64;
/** Zell-Zustände des Rasters. */
export const GRID_OFF = 0;
export const GRID_HIT = 1;
export const GRID_ACCENT = 2;
export const GRID_TIE = 3;
export type GridCell = 0 | 1 | 2 | 3;

const MASK_MAX = 4294967295;

function maskParam(id: string, label: string, defaultValue: number): ParameterSchema {
  return {
    id,
    label,
    description: 'Internes Bitmuster des Rasters (wird über das Klick-Raster bearbeitet).',
    domain: 'time',
    min: 0,
    max: MASK_MAX,
    step: 1,
    defaultValue,
    curve: 'linear',
    modulatable: false,
    hidden: true,
  };
}

const GRID_STEPS_PARAM: ParameterSchema = {
  id: 'steps',
  label: 'Unterteilungen (Steps)',
  description:
    'In wie viele gleich lange Schritte der Layer-Zyklus geteilt wird (16 bei 4 Beats = Sechzehntel, 12 = Achtel-Triolen).',
  domain: 'time',
  min: 1,
  max: GRID_MAX_STEPS,
  step: 1,
  defaultValue: 16,
  curve: 'linear',
  modulatable: false,
};
const GRID_PAT_A = maskParam('patA', 'Schläge 1–32', 0x1111);
const GRID_PAT_B = maskParam('patB', 'Schläge 33–64', 0);
const GRID_ACC_A = maskParam('accA', 'Akzente 1–32', 0);
const GRID_ACC_B = maskParam('accB', 'Akzente 33–64', 0);
const GRID_TIE_A = maskParam('tieA', 'Haltebögen 1–32', 0);
const GRID_TIE_B = maskParam('tieB', 'Haltebögen 33–64', 0);

const GRID_GATE_PARAM: ParameterSchema = {
  id: 'gateLen',
  label: 'Ton-Länge',
  description:
    'Wie lange jeder Schlag gehalten wird (Anteil seines Steps). Für längere Töne Haltebögen ins Raster malen.',
  domain: 'time',
  min: 0.05,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};
const GRID_PEAK_PARAM: ParameterSchema = {
  id: 'peak',
  label: 'Spitze (Kantigkeit)',
  description:
    '0 = weich anschwellende, runde Kurve · 1 = kantiger, sofortiger Einsatz mit spitzem Abfall.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};
const GRID_DECAY_PARAM: ParameterSchema = {
  id: 'decay',
  label: 'Ausklang',
  description: 'Wie lange die Kurve nach dem Loslassen ausklingt – in Steps (0,02 = sofort aus, 8 = lange Fahne).',
  domain: 'time',
  min: 0.02,
  max: 8,
  defaultValue: 1,
  curve: 'exp',
  modulatable: true,
  unitLabel: 'Steps',
};
const GRID_DELAY_PARAM: ParameterSchema = {
  id: 'delay',
  label: 'Verzögerung (früher ↔ später)',
  description:
    'Schiebt das ganze Muster um einen Bruchteil eines Steps: positiv = später (laid-back), negativ = früher (treibend).',
  domain: 'time',
  min: -0.5,
  max: 0.5,
  defaultValue: 0,
  curve: 'bipolar',
  modulatable: true,
};
const GRID_ROTATION_PARAM: ParameterSchema = {
  id: 'rotation',
  label: 'Verschiebung (ganze Steps)',
  description: 'Rotiert das Muster um ganze Steps nach hinten – gleiche Schläge, anderer Groove. Bewegbar.',
  domain: 'time',
  min: 0,
  max: GRID_MAX_STEPS - 1,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};
const GRID_ACCENT_PARAM: ParameterSchema = {
  id: 'accentAmt',
  label: 'Akzent-Stärke',
  description: 'Wie viel leiser normale Schläge gegenüber Akzenten sind (0 = alle gleich laut).',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.4,
  curve: 'linear',
  modulatable: true,
};
const GRID_FILL_PARAM: ParameterSchema = {
  id: 'fillHits',
  label: 'Zusatz-Schläge (Euklid)',
  description:
    'Fügt k gleichmäßig verteilte Schläge zum gemalten Muster hinzu – mit einer Bewegung (~) verdichtet sich der Rhythmus z. B. zu einem Wirbel.',
  domain: 'time',
  min: 0,
  max: GRID_MAX_STEPS,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

function bitAt(a: number, b: number, i: number): number {
  return i < 32 ? (a >>> i) & 1 : (b >>> (i - 32)) & 1;
}

/** Zell-Zustand von Step `step` (rotiert, inkl. Euklid-Zusatz). Zero alloc. */
function gridCellAt(
  step: number,
  n: number,
  rot: number,
  pA: number,
  pB: number,
  aA: number,
  aB: number,
  tA: number,
  tB: number,
  fillK: number,
): number {
  const src = (((step - rot) % n) + n) % n;
  if (bitAt(pA, pB, src) === 1) return bitAt(aA, aB, src) === 1 ? GRID_ACCENT : GRID_HIT;
  if (fillK > 0 && isEuclidHit(src, fillK, n)) return GRID_HIT;
  if (bitAt(tA, tB, src) === 1) return GRID_TIE;
  return GRID_OFF;
}

function gridAttack(x: number, aLen: number): number {
  if (aLen <= 1e-4 || x >= aLen) return 1;
  if (x <= 0) return 0;
  return 0.5 - 0.5 * Math.cos((Math.PI * x) / aLen);
}

/** Hüllkurve einer Note: t = Zeit seit Einsatz (Steps), gateEnd = Loslassen. */
function gridNoteEnv(t: number, gateEnd: number, aLen: number, decay: number, pw: number): number {
  if (t < gateEnd) return gridAttack(t, aLen);
  const x = (t - gateEnd) / decay;
  if (x >= 1) return 0;
  return gridAttack(gateEnd, aLen) * Math.pow(1 - x, pw);
}

/** Liest die (unrotierten) Zellen eines Raster-Operators – für UI & Tests. */
export function readGridCells(params: Record<string, number>, steps?: number): GridCell[] {
  const n = Math.max(1, Math.min(GRID_MAX_STEPS, Math.round(steps ?? params.steps ?? 16)));
  const get = (id: string, def: number) => {
    const v = params[id];
    return (v === undefined || !Number.isFinite(v) ? def : Math.round(v)) >>> 0;
  };
  const pA = get('patA', 0x1111);
  const pB = get('patB', 0);
  const aA = get('accA', 0);
  const aB = get('accB', 0);
  const tA = get('tieA', 0);
  const tB = get('tieB', 0);
  const out: GridCell[] = [];
  for (let i = 0; i < n; i++) {
    if (bitAt(pA, pB, i)) out.push(bitAt(aA, aB, i) ? GRID_ACCENT : GRID_HIT);
    else if (bitAt(tA, tB, i)) out.push(GRID_TIE);
    else out.push(GRID_OFF);
  }
  return out;
}

/** Bitmasken-Parameter aus einer Zell-Liste (max. 64 Zellen). */
export function gridParamsFromCells(cells: readonly number[]): Record<string, number> {
  const masks = { patA: 0, patB: 0, accA: 0, accB: 0, tieA: 0, tieB: 0 };
  for (let i = 0; i < Math.min(GRID_MAX_STEPS, cells.length); i++) {
    const c = cells[i];
    const hi = i >= 32;
    const bit = 2 ** (hi ? i - 32 : i);
    if (c === GRID_HIT || c === GRID_ACCENT) {
      if (hi) masks.patB += bit;
      else masks.patA += bit;
      if (c === GRID_ACCENT) {
        if (hi) masks.accB += bit;
        else masks.accA += bit;
      }
    } else if (c === GRID_TIE) {
      if (hi) masks.tieB += bit;
      else masks.tieA += bit;
    }
  }
  return masks;
}

/** Zellen eines euklidischen Musters (k aus n, optional rotiert). */
export function euclidCells(steps: number, hits: number, rotation = 0): GridCell[] {
  return euclidPattern(steps, hits, rotation).map((on) => (on ? GRID_HIT : GRID_OFF));
}

export const timeStepGridOperator: TimeOperatorModule = {
  id: 'time-step-grid',
  version: 1,
  displayName: 'Rhythmus-Raster',
  description:
    'Teilt den Zyklus in Steps; Schläge, Akzente und Haltebögen werden per Klick gesetzt. Spitze, Ton-Länge und Ausklang formen die Kurve jedes Schlags.',
  parameters: [
    GRID_STEPS_PARAM,
    GRID_PAT_A,
    GRID_PAT_B,
    GRID_ACC_A,
    GRID_ACC_B,
    GRID_TIE_A,
    GRID_TIE_B,
    GRID_GATE_PARAM,
    GRID_PEAK_PARAM,
    GRID_DECAY_PARAM,
    GRID_DELAY_PARAM,
    GRID_ROTATION_PARAM,
    GRID_ACCENT_PARAM,
    GRID_FILL_PARAM,
  ],
  evaluateTimeInto(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void {
    const n = Math.max(1, Math.round(readParam(GRID_STEPS_PARAM, params)));
    const rot = ((Math.round(readParam(GRID_ROTATION_PARAM, params)) % n) + n) % n;
    const pA = readParam(GRID_PAT_A, params) >>> 0;
    const pB = readParam(GRID_PAT_B, params) >>> 0;
    const aA = readParam(GRID_ACC_A, params) >>> 0;
    const aB = readParam(GRID_ACC_B, params) >>> 0;
    const tA = readParam(GRID_TIE_A, params) >>> 0;
    const tB = readParam(GRID_TIE_B, params) >>> 0;
    const fillK = Math.max(0, Math.min(n, Math.round(readParam(GRID_FILL_PARAM, params))));
    const gateLen = readParam(GRID_GATE_PARAM, params);
    const peak = readParam(GRID_PEAK_PARAM, params);
    const decay = Math.max(0.02, readParam(GRID_DECAY_PARAM, params));
    const delay = readParam(GRID_DELAY_PARAM, params);
    const accentAmt = readParam(GRID_ACCENT_PARAM, params);

    const p = wrapPhase01(prevFrame.warpedPhase);
    let u = p * n - delay;
    if (u < 0) u += n;
    else if (u >= n) u -= n;
    let s = Math.floor(u);
    if (s >= n) s = n - 1;
    if (s < 0) s = 0;
    const f = u - s;

    const aLen = (1 - peak) * (1 - peak) * 0.5;
    const pw = 0.6 + 2.4 * peak;
    const softVel = 1 - 0.5 * accentAmt;

    // Aktuelle Note: letzter Einsatz am oder vor Step s.
    let onsetK = -1;
    let onsetCell = GRID_OFF;
    for (let k = 0; k < n; k++) {
      const c = gridCellAt(s - k, n, rot, pA, pB, aA, aB, tA, tB, fillK);
      if (c === GRID_HIT || c === GRID_ACCENT) {
        onsetK = k;
        onsetCell = c;
        break;
      }
    }

    let energy = 0;
    let gate = 0;
    let vel = 0;
    if (onsetK >= 0) {
      const onset = s - onsetK;
      let len = 1;
      while (len < n && gridCellAt(onset + len, n, rot, pA, pB, aA, aB, tA, tB, fillK) === GRID_TIE) len++;
      const gateEnd = len - 1 + gateLen;
      const t = onsetK + f;
      vel = onsetCell === GRID_ACCENT ? 1 : softVel;
      energy = gridNoteEnv(t, gateEnd, aLen, decay, pw) * vel;
      gate = t < gateEnd ? 1 : 0;

      // Ausklang der vorherigen Note nicht abschneiden (weicher Übergang).
      if (aLen > 1e-4 || energy < vel) {
        for (let k = onsetK + 1; k <= onsetK + n; k++) {
          const c = gridCellAt(s - k, n, rot, pA, pB, aA, aB, tA, tB, fillK);
          if (c !== GRID_HIT && c !== GRID_ACCENT) continue;
          const prevOnset = s - k;
          let plen = 1;
          while (plen < n && gridCellAt(prevOnset + plen, n, rot, pA, pB, aA, aB, tA, tB, fillK) === GRID_TIE) plen++;
          const pvel = c === GRID_ACCENT ? 1 : softVel;
          const tail = gridNoteEnv(k + f, plen - 1 + gateLen, aLen, decay, pw) * pvel;
          if (tail > energy) energy = tail;
          break;
        }
      }
    }

    // Neuer Step? (Gedächtnis im Engine-Slot; erkennt auch Zyklus-Sprünge bei 1 Step.)
    const state = ctx.slotState;
    let isNewStep: boolean;
    if (state) {
      const prevS = state[0]!;
      const prevU = state[1]!;
      isNewStep = s !== prevS || (Number.isFinite(prevU) && u + 1e-9 < prevU - 0.5);
      state[0] = s;
      state[1] = u;
    } else {
      isNewStep = s !== prevFrame.stepIndex;
    }
    const cellNow = onsetK === 0 ? onsetCell : GRID_OFF;
    const trigger = isNewStep && (cellNow === GRID_HIT || cellNow === GRID_ACCENT) ? vel : 0;

    outFrame.warpedPhase = p;
    outFrame.pulseEnergy = energy;
    outFrame.triggerIntensity = trigger;
    outFrame.accent = vel;
    outFrame.stepIndex = s;
    outFrame.pulseSlope = 0;
    outFrame.gate = gate;
  },
  evaluateTime(ctx: TimeEvalContext, params: Record<string, number>, prevFrame: TimeFrame): TimeFrame {
    const out: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: 0,
      pulseSlope: 0,
      gate: 0,
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

/** Zeit-Operatoren, die selbst Schläge erzeugen (sonst ist die Energie flach 1). */
export function isPulseGeneratorModule(moduleId: string): boolean {
  return (
    moduleId === 'time-step-grid' ||
    moduleId === 'time-pulse-interference' ||
    moduleId === 'time-euclid'
  );
}

export const TIME_OPERATORS: readonly TimeOperatorModule[] = [
  timeWarpOperator,
  timeGridGravityOperator,
  timePhaseDriftOperator,
  timeSwingOperator,
  timePulseInterferenceOperator,
  timeEuclidOperator,
  timeStepGridOperator,
  timeChanceOperator,
];
