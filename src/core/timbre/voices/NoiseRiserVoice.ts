import { clamp, sanitizeSampleRate, WhiteNoiseGenerator, ZdfSvfFilter } from '../../dsp';
import type {
  ParameterSchema,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { midiToFreq } from '../../theory';
import { clamp01, fastTanh, readParam } from './voiceUtils';

/**
 * Rausch-Welle (Riser / Sweep): kein Anschlag-Instrument, sondern ein Klang,
 * der über die GANZE Layer-Zykluslänge wächst. Zykluslänge = 8 Takte → ein
 * 8-Takt-Aufbau. Filter, Lautstärke und ein optionaler Ton folgen der Phase.
 */

const DIRECTION_PARAM: ParameterSchema = {
  id: 'direction',
  label: 'Richtung',
  description: 'Aufwärts = Spannungsaufbau vor dem Drop, Abwärts = Abfahrt danach, Auf & Ab = Atmen (Swell).',
  domain: 'timbre',
  min: 0,
  max: 2,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Aufwärts (Riser)' },
    { value: 1, label: 'Abwärts (Abfahrt)' },
    { value: 2, label: 'Auf & Ab (Swell)' },
  ],
};

const RANGE_PARAM: ParameterSchema = {
  id: 'sweepRange',
  label: 'Weg der Welle',
  description: 'Wie weit das Rauschen von dunkel nach hell wandert.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.75,
  curve: 'linear',
  modulatable: true,
};

const TENSION_PARAM: ParameterSchema = {
  id: 'tension',
  label: 'Spannungskurve',
  description: '0 = gleichmäßig wachsend, 1 = lange leise und erst ganz am Ende explodierend.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const RESONANCE_PARAM: ParameterSchema = {
  id: 'resonance',
  label: 'Pfeifen (Resonanz)',
  description: 'Rundes Rauschen bis pfeifend-singender Wind.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.4,
  curve: 'linear',
  modulatable: true,
};

const TONE_MIX_PARAM: ParameterSchema = {
  id: 'toneMix',
  label: 'Ton im Rauschen',
  description: 'Mischt einen mitsteigenden Ton (Grundton der Tonart, Oktaven) zum Rauschen.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.2,
  curve: 'linear',
  modulatable: true,
};

const PULSE_GATE_PARAM: ParameterSchema = {
  id: 'pulseGate',
  label: 'Rhythmisches Zerhacken',
  description: '0 = durchgehende Welle, 1 = die Welle wird vom Puls des Layers rhythmisch zerhackt (Puls-Interferenz/Euklid bestimmt den Rhythmus).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const WIDTH_PARAM: ParameterSchema = {
  id: 'width',
  label: 'Stereo-Breite',
  description: 'Mono bis sehr breit.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.8,
  curve: 'linear',
  modulatable: true,
};

export class NoiseRiserVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly noiseL = new WhiteNoiseGenerator(0x3c6ef372);
  private readonly noiseR = new WhiteNoiseGenerator(0xa54ff53a);
  private readonly fL: ZdfSvfFilter;
  private readonly fR: ZdfSvfFilter;
  private tonePhase = 0;
  private gateSmooth = 1;
  private ampSmooth = 0;
  private readonly smoothCoeff: number;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.fL = new ZdfSvfFilter(this.sampleRate, 400, 1, 0.6);
    this.fR = new ZdfSvfFilter(this.sampleRate, 420, 1, 0.6);
    this.smoothCoeff = Math.exp(-1 / (0.004 * this.sampleRate));
  }

  public reset(): void {
    this.fL.reset();
    this.fR.reset();
    this.tonePhase = 0;
    this.gateSmooth = 1;
    this.ampSmooth = 0;
  }

  public process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (count <= 0) return;
    const sr = this.sampleRate;

    const direction = Math.round(readParam(DIRECTION_PARAM, params));
    const range = readParam(RANGE_PARAM, params);
    const tension = readParam(TENSION_PARAM, params);
    const resonance = readParam(RESONANCE_PARAM, params);
    const toneMix = readParam(TONE_MIX_PARAM, params);
    const pulseGate = readParam(PULSE_GATE_PARAM, params);
    const width = readParam(WIDTH_PARAM, params);

    const p = Number.isFinite(ctx.timeFrame.warpedPhase) ? clamp01(ctx.timeFrame.warpedPhase) : 0;
    let x: number;
    if (direction === 1) x = 1 - p;
    else if (direction === 2) x = p < 0.5 ? p * 2 : (1 - p) * 2;
    else x = p;
    // Spannungskurve: Exponent 1 … 4
    const shaped = Math.pow(x, 1 + tension * 3);

    const lowHz = 180;
    const highHz = lowHz * Math.pow(2, 2 + range * 4.5); // bis ~ 16 kHz
    const fHz = clamp(lowHz * Math.pow(highHz / lowHz, shaped), 60, sr * 0.42);
    const q = 0.7 + resonance * 4.2;
    this.fL.setParams(fHz, q, 0.6 + resonance * 0.4);
    this.fR.setParams(Math.min(fHz * (1 + 0.08 * width), sr * 0.42), q, 0.6 + resonance * 0.4);

    // Lautstärke wächst mit der Spannung (Abfahrt: fällt)
    const ampTarget = 0.05 + 0.95 * shaped;
    const pe = Number.isFinite(ctx.timeFrame.pulseEnergy) ? clamp01(ctx.timeFrame.pulseEnergy) : 1;
    const gateTarget = 1 - pulseGate + pulseGate * (pe > 0.08 ? pe : 0);

    // Ton: Grundton der Harmonie, steigt mit der Welle um bis zu 2 Oktaven
    const rootMidi = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 33;
    const toneHz = clamp(midiToFreq(rootMidi + 24 + shaped * 24 * range), 30, sr * 0.4);
    const toneInc = toneHz / sr;

    const sc = this.smoothCoeff;
    let gateSmooth = this.gateSmooth;
    let ampSmooth = this.ampSmooth;
    let tonePhase = this.tonePhase;
    const noiseAmt = 1 - 0.6 * toneMix;
    const toneAmt = toneMix * 0.45;
    const outGain = 0.55 / (1 + resonance * 0.8);

    for (let i = 0; i < count; i++) {
      gateSmooth = gateTarget + (gateSmooth - gateTarget) * sc;
      ampSmooth = ampTarget + (ampSmooth - ampTarget) * sc;
      const nL = this.noiseL.processSample();
      const nR = this.noiseR.processSample();
      const nMid = (nL + nR) * 0.5;
      tonePhase += toneInc;
      if (tonePhase >= 1) tonePhase -= 1;
      // leicht gesägter Ton (Sinus + 2. Teilton)
      const tone = Math.sin(tonePhase * 6.283185307) + 0.3 * Math.sin(tonePhase * 12.566370614);
      const a = ampSmooth * gateSmooth;
      const yL = this.fL.processSample((nMid + (nL - nMid) * width) * noiseAmt) + tone * toneAmt;
      const yR = this.fR.processSample((nMid + (nR - nMid) * width) * noiseAmt) + tone * toneAmt;
      const oL = fastTanh(yL * a * 1.4) * outGain;
      const oR = fastTanh(yR * a * 1.4) * outGain;
      outL[i] = oL * 0 === 0 ? oL : 0;
      outR[i] = oR * 0 === 0 ? oR : 0;
    }
    this.gateSmooth = gateSmooth;
    this.ampSmooth = ampSmooth;
    this.tonePhase = tonePhase;
  }
}

export const noiseRiserVoiceModule: VoiceModule = {
  id: 'noise-riser',
  version: 1,
  category: 'texture',
  displayName: 'Rausch-Welle (Riser)',
  description:
    'Wachsende Rausch-Welle über die ganze Zykluslänge – für Aufbauten vor dem Drop, Abfahrten und atmende Flächen. Zykluslänge = Länge des Aufbaus.',
  parameters: [DIRECTION_PARAM, RANGE_PARAM, TENSION_PARAM, RESONANCE_PARAM, TONE_MIX_PARAM, PULSE_GATE_PARAM, WIDTH_PARAM],
  createInstance(sampleRate: number): VoiceInstance {
    return new NoiseRiserVoice(sampleRate);
  },
};
