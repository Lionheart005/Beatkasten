import { clamp, DCBlocker, PolyBlepOscillator, sanitizeSampleRate, ZdfSvfFilter } from '../../dsp';
import type {
  ParameterSchema,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { midiToFreq } from '../../theory';
import { MELODY_EXTRA_PARAMS } from '../../theory/melody';
import { BASS_RANGE_PARAM, BassNotePicker, createBassOctaveParam, createBassPatternParam } from './bassNotes';
import { clamp01, decayCoeff, detectNewTrigger, DIST_MODE_OPTIONS, distort, readParam } from './voiceUtils';

/**
 * Reese-Bass: drei gegeneinander verstimmte Sägezähne erzeugen das typische
 * Schweben/Phasing, ein sauberer Sinus-Sub hält das Fundament mono. Tiefpass mit
 * tempo-synchronem „Wobble“, Verzerrung und Gleiten – dunkel, schwer, bedrohlich.
 */

const DETUNE_PARAM: ParameterSchema = {
  id: 'detune',
  label: 'Schwebung (Verstimmung)',
  description: 'Wie weit die drei Sägezähne gegeneinander verstimmt sind – wenig = ruhig, viel = schwer wabernd.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const SUB_PARAM: ParameterSchema = {
  id: 'sub',
  label: 'Sub-Fundament',
  description: 'Sauberer Sinus auf dem Grundton (mono) – trägt den Druck, während oben verzerrt wird.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const CUTOFF_PARAM: ParameterSchema = {
  id: 'cutoff',
  label: 'Helligkeit (Filter)',
  description: 'Dumpf grollend bis offen und schneidend.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const RESONANCE_PARAM: ParameterSchema = {
  id: 'resonance',
  label: 'Filter-Betonung',
  description: 'Betont die Filterkante – mehr = nasaler, „sprechender“ Bass.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.25,
  curve: 'linear',
  modulatable: true,
};

const ENV_PARAM: ParameterSchema = {
  id: 'filterEnv',
  label: 'Aufreißen pro Ton',
  description: 'Wie stark das Filter bei jedem Ton kurz aufgeht.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const WOBBLE_RATE_PARAM: ParameterSchema = {
  id: 'wobbleRate',
  label: 'Wobble-Tempo',
  description: 'Rhythmisches Auf und Zu des Filters, im Takt mitlaufend.',
  domain: 'time',
  min: 0,
  max: 7,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Aus' },
    { value: 1, label: '1 Takt' },
    { value: 2, label: '1/2' },
    { value: 3, label: '1/4' },
    { value: 4, label: '1/8' },
    { value: 5, label: '1/8 Triole' },
    { value: 6, label: '1/16' },
    { value: 7, label: '2 Takte' },
  ],
};

const WOBBLE_DEPTH_PARAM: ParameterSchema = {
  id: 'wobbleDepth',
  label: 'Wobble-Tiefe',
  description: 'Wie weit das Filter beim Wobble auf- und zugeht.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const DRIVE_PARAM: ParameterSchema = {
  id: 'drive',
  label: 'Verzerrung',
  description: 'Von warm angedickt bis brutal zerrissen (nur der obere Teil – der Sub bleibt sauber).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const DIST_MODE_PARAM: ParameterSchema = {
  id: 'distMode',
  label: 'Verzerrungs-Art',
  description: 'Charakter der Verzerrung.',
  domain: 'timbre',
  min: 0,
  max: 4,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: DIST_MODE_OPTIONS,
};

const LENGTH_PARAM: ParameterSchema = {
  id: 'noteLength',
  label: 'Ton-Länge',
  description: 'Kurz gestoßen bis lang liegend (1 = Ton hält bis zum nächsten).',
  domain: 'timbre',
  min: 0.03,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const GLIDE_PARAM: ParameterSchema = {
  id: 'glide',
  label: 'Gleiten',
  description: 'Wie weich die Tonhöhe zum nächsten Ton gleitet (0 = springt).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.15,
  curve: 'linear',
  modulatable: true,
};

const WIDTH_PARAM: ParameterSchema = {
  id: 'width',
  label: 'Stereo-Breite',
  description: 'Breite der verstimmten Sägezähne (der Sub bleibt immer mittig).',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const PATTERN_PARAM = createBassPatternParam(0);
const OCTAVE_PARAM = createBassOctaveParam(0);

const WOBBLE_BEATS = [0, 4, 2, 1, 0.5, 1 / 3, 0.25, 8];

export class ReeseBassVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly oscC: PolyBlepOscillator;
  private readonly oscL: PolyBlepOscillator;
  private readonly oscR: PolyBlepOscillator;
  private readonly lpL1: ZdfSvfFilter;
  private readonly lpL2: ZdfSvfFilter;
  private readonly lpR1: ZdfSvfFilter;
  private readonly lpR2: ZdfSvfFilter;
  private readonly dcL: DCBlocker;
  private readonly dcR: DCBlocker;
  private readonly picker = new BassNotePicker();
  private subPhase = 0;
  private curMidi = 33;
  private targetMidi = 33;
  private amp = 0;
  private filterEnv = 0;
  private hasNote = false;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.oscC = new PolyBlepOscillator(this.sampleRate);
    this.oscL = new PolyBlepOscillator(this.sampleRate);
    this.oscR = new PolyBlepOscillator(this.sampleRate);
    this.oscC.setWaveform('saw');
    this.oscL.setWaveform('saw');
    this.oscR.setWaveform('saw');
    this.oscL.reset(0.33);
    this.oscR.reset(0.71);
    this.lpL1 = new ZdfSvfFilter(this.sampleRate, 400, 0.7, 0);
    this.lpL2 = new ZdfSvfFilter(this.sampleRate, 400, 0.9, 0);
    this.lpR1 = new ZdfSvfFilter(this.sampleRate, 400, 0.7, 0);
    this.lpR2 = new ZdfSvfFilter(this.sampleRate, 400, 0.9, 0);
    this.dcL = new DCBlocker(this.sampleRate, 20);
    this.dcR = new DCBlocker(this.sampleRate, 20);
  }

  public reset(): void {
    this.oscC.reset(0);
    this.oscL.reset(0.33);
    this.oscR.reset(0.71);
    this.lpL1.reset();
    this.lpL2.reset();
    this.lpR1.reset();
    this.lpR2.reset();
    this.dcL.reset();
    this.dcR.reset();
    this.picker.reset();
    this.subPhase = 0;
    this.amp = 0;
    this.filterEnv = 0;
    this.hasNote = false;
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

    const detune = readParam(DETUNE_PARAM, params);
    const sub = readParam(SUB_PARAM, params);
    const cutoff = readParam(CUTOFF_PARAM, params);
    const reso = readParam(RESONANCE_PARAM, params);
    const envAmt = readParam(ENV_PARAM, params);
    const wobbleIdx = Math.round(readParam(WOBBLE_RATE_PARAM, params));
    const wobbleDepth = readParam(WOBBLE_DEPTH_PARAM, params);
    const drive = readParam(DRIVE_PARAM, params);
    const mode = Math.round(readParam(DIST_MODE_PARAM, params));
    const noteLength = readParam(LENGTH_PARAM, params);
    const glide = readParam(GLIDE_PARAM, params);
    const width = readParam(WIDTH_PARAM, params);

    const trig = detectNewTrigger(ctx);
    if (trig > 0) {
      const midi = this.picker.next(ctx, params, PATTERN_PARAM, OCTAVE_PARAM);
      if (!Number.isNaN(midi)) {
        this.targetMidi = midi;
        if (!this.hasNote || glide <= 0.001) this.curMidi = midi;
        this.hasNote = true;
        const accent = Number.isFinite(ctx.timeFrame.accent) ? clamp01(ctx.timeFrame.accent) : 0.7;
        this.amp = Math.max(this.amp, 0.75 + 0.25 * accent);
        this.filterEnv = 1;
      }
    }

    // Ton-Länge 1 = liegt praktisch bis zum nächsten Ton
    const ampCoeff = noteLength >= 0.995 ? 1 : decayCoeff(0.04 + noteLength * noteLength * 2.2, sr);
    const fEnvCoeff = decayCoeff(0.12, sr);
    const glideCoeff = glide > 0.001 ? Math.exp(-8 / (Math.max(1, glide * 0.18 * sr))) : 0;

    // Wobble-Phase direkt aus der Beat-Position (immer im Takt)
    const wBeats = WOBBLE_BEATS[wobbleIdx] ?? 0;
    const beatsPerBar = ctx.beatsPerBar > 0 ? ctx.beatsPerBar : 4;
    const wobblePeriod = wobbleIdx === 1 ? beatsPerBar : wobbleIdx === 7 ? beatsPerBar * 2 : wBeats;
    let wobble = 0;
    if (wobblePeriod > 0) {
      const ph = ((ctx.beatPosition / wobblePeriod) % 1 + 1) % 1;
      wobble = 0.5 - 0.5 * Math.cos(ph * 6.283185307); // 0 auf der Zählzeit, 1 in der Mitte
    }

    const spread = 0.0008 + detune * detune * 0.022; // Frequenzverhältnis ±
    const driveGain = 1 + drive * 9;
    const driveNorm = 0.42 / (1 + drive * 0.9);
    const q = 0.7 + reso * 3.4;
    const maxHz = sr * 0.42;
    const sideAmt = width;
    const invSr = 1 / sr;

    let curMidi = this.curMidi;
    let amp = this.amp;
    let filterEnv = this.filterEnv;

    for (let start = 0; start < count; start += 16) {
      const end = Math.min(start + 16, count);
      if (glideCoeff > 0) curMidi = this.targetMidi + (curMidi - this.targetMidi) * Math.pow(glideCoeff, end - start);
      else curMidi = this.targetMidi;
      const hz = clamp(midiToFreq(curMidi), 20, maxHz);
      this.oscC.setFreq(hz);
      this.oscL.setFreq(hz * (1 - spread));
      this.oscR.setFreq(hz * (1 + spread * 1.07));
      const cutNorm = clamp01(cutoff + envAmt * 0.45 * filterEnv + (wobbleDepth * (wobble - 0.5) * (wobblePeriod > 0 ? 1 : 0)));
      const fHz = clamp(55 * Math.pow(90, cutNorm), 40, maxHz);
      this.lpL1.setParams(fHz, 0.7, 0);
      this.lpL2.setParams(fHz, q, 0);
      this.lpR1.setParams(fHz * 1.02, 0.7, 0);
      this.lpR2.setParams(fHz * 1.02, q, 0);
      const subHz = hz;

      for (let i = start; i < end; i++) {
        const c = this.oscC.processSample();
        const l = this.oscL.processSample();
        const r = this.oscR.processSample();
        const mid = (c + l + r) * 0.4;
        const sideSig = (l - r) * 0.35 * sideAmt;
        const fL = this.lpL2.processSample(this.lpL1.processSample(mid + sideSig));
        const fR = this.lpR2.processSample(this.lpR1.processSample(mid - sideSig));
        const dL = distort(fL * driveGain, mode) * driveNorm;
        const dR = distort(fR * driveGain, mode) * driveNorm;
        this.subPhase += subHz * invSr;
        if (this.subPhase >= 1) this.subPhase -= 1;
        const s = Math.sin(this.subPhase * 6.283185307) * sub * 0.55;
        const yL = this.dcL.processSample((dL + s) * amp);
        const yR = this.dcR.processSample((dR + s) * amp);
        outL[i] = yL * 0 === 0 ? yL : 0;
        outR[i] = yR * 0 === 0 ? yR : 0;
        amp *= ampCoeff;
        filterEnv *= fEnvCoeff;
      }
    }
    if (amp < 1e-6) amp = 0;
    this.curMidi = curMidi;
    this.amp = amp;
    this.filterEnv = filterEnv;
  }
}

export const reeseBassVoiceModule: VoiceModule = {
  id: 'reese-bass',
  version: 1,
  category: 'bass',
  displayName: 'Reese-Bass (schwebend & dunkel)',
  description:
    'Schwerer, wabernder Bass aus verstimmten Sägezähnen mit sauberem Sub, Wobble im Takt und Verzerrung – für dunkle, treibende Bass-Linien.',
  parameters: [
    DETUNE_PARAM,
    SUB_PARAM,
    CUTOFF_PARAM,
    RESONANCE_PARAM,
    ENV_PARAM,
    WOBBLE_RATE_PARAM,
    WOBBLE_DEPTH_PARAM,
    DRIVE_PARAM,
    DIST_MODE_PARAM,
    LENGTH_PARAM,
    GLIDE_PARAM,
    WIDTH_PARAM,
    OCTAVE_PARAM,
    PATTERN_PARAM,
    BASS_RANGE_PARAM,
    ...MELODY_EXTRA_PARAMS,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new ReeseBassVoice(sampleRate);
  },
};
