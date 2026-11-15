import {
  gridGravityPull,
  interferenceEnergy,
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
  max: 12,
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
  defaultValue: 0.35,
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
  max: 16,
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
  max: 16,
  step: 1,
  defaultValue: 3,
  curve: 'linear',
  modulatable: false,
};

const INTERFERENCE_MIX_PARAM: ParameterSchema = {
  id: 'interferenceMix',
  label: 'Wellen-Mischung',
  description: 'Balance zwischen Grundpuls A und Gegenwelle B.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.45,
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
  defaultValue: 0.125,
  curve: 'linear',
  modulatable: true,
};

const THRESHOLD_PARAM: ParameterSchema = {
  id: 'threshold',
  label: 'Auslöse-Schwelle',
  description: 'Bestimmt, wie spitz oder breit die einzelnen Impulse aus der Welle ragen.',
  domain: 'time',
  min: 0.05,
  max: 0.92,
  defaultValue: 0.42,
  curve: 'linear',
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

    const p = wrapPhase01(prevFrame.warpedPhase);
    const pulseEnergy = interferenceEnergy(
      p,
      freqA,
      freqB,
      mix,
      phaseOffset,
      threshold,
    );
    const stepIndex = Math.floor(p * freqA);
    const rawAccent = pulseEnergy * (1 - 0.3 * Math.abs(Math.sin(Math.PI * p)));
    const accent = rawAccent < 0 ? 0 : rawAccent > 1 ? 1 : rawAccent;

    const crossedThreshold = pulseEnergy > 0.12 && prevFrame.pulseEnergy <= 0.12;
    const steppedInEnergy = prevFrame.stepIndex !== stepIndex && pulseEnergy > 0.08;

    let triggerIntensity = 0;
    if (crossedThreshold || steppedInEnergy) {
      // Look slightly ahead within the current lobe so smooth sine rising edges
      // report musical peak velocity rather than just the threshold crossing value.
      const lobeStep = 1 / freqA;
      const ahead1 = interferenceEnergy(
        p + lobeStep * 0.14,
        freqA,
        freqB,
        mix,
        phaseOffset,
        threshold,
      );
      const ahead2 = interferenceEnergy(
        p + lobeStep * 0.25,
        freqA,
        freqB,
        mix,
        phaseOffset,
        threshold,
      );
      const peak = Math.max(pulseEnergy, ahead1, ahead2);
      triggerIntensity = peak < 0 ? 0 : peak > 1 ? 1 : peak;
    }

    outFrame.warpedPhase = p;
    outFrame.pulseEnergy = pulseEnergy;
    outFrame.triggerIntensity = triggerIntensity;
    outFrame.accent = accent;
    outFrame.stepIndex = stepIndex;
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
    };
    this.evaluateTimeInto!(ctx, params, prevFrame, out);
    return out;
  },
};

export const TIME_OPERATORS: readonly TimeOperatorModule[] = [
  timeWarpOperator,
  timeGridGravityOperator,
  timePhaseDriftOperator,
  timePulseInterferenceOperator,
];
