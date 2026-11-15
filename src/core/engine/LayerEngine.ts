import { clamp, OnePoleSmoother, sanitizeSampleRate } from '../dsp/smoothing';
import { wrapPhase01 } from '../math/waves';
import { ModuleRegistry } from '../registry/ModuleRegistry';
import {
  buildDefaultParams,
  LAYER_MIX_PARAMETERS,
  type HarmonyFrame,
  type MutableTimeFrame,
  type ParameterSchema,
  type ProcessorContext,
  type ProcessorInstance,
  type ProcessorModule,
  type TimeEvalContext,
  type TimeFrame,
  type TimeOperatorModule,
  type VoiceInstance,
  type VoiceModule,
  type VoiceRenderContext,
} from '../registry/types';
import { ModulationRouter } from '../modulation/ModulationRouter';
import { type LayerConfig } from '../state/types';
import { cycleToBeats } from '../theory/cycles';

export const CONTROL_SUBBLOCK_SIZE = 32;
const HALF_PI = Math.PI * 0.5;
const DEFAULT_MAX_BLOCK_SIZE = 4096;

function syncStaticParams(
  schemas: readonly ParameterSchema[],
  baseParams: Record<string, number>,
  effectiveParams: Record<string, number>,
): void {
  for (let i = 0; i < schemas.length; i++) {
    const s = schemas[i]!;
    const raw = baseParams[s.id];
    const safe = raw === undefined || !Number.isFinite(raw) ? s.defaultValue : raw;
    let v = safe < s.min ? s.min : safe > s.max ? s.max : safe;
    if (s.step !== undefined && s.step > 0) {
      const stepped = Math.round((v - s.min) / s.step) * s.step + s.min;
      v = stepped < s.min ? s.min : stepped > s.max ? s.max : stepped;
    }
    effectiveParams[s.id] = v;
  }
}

interface TimeOpSlot {
  readonly id: string;
  readonly moduleId: string;
  readonly module: TimeOperatorModule;
  bypassed: boolean;
  wasModulated: boolean;
  baseParams: Record<string, number>;
  readonly effectiveParams: Record<string, number>;
}

interface ProcessorSlot {
  readonly cardId: string;
  readonly moduleId: string;
  readonly module: ProcessorModule;
  readonly instance: ProcessorInstance;
  bypassed: boolean;
  wasModulated: boolean;
  baseParams: Record<string, number>;
  readonly effectiveParams: Record<string, number>;
}

interface MutableTimeEvalContext {
  beatPosition: number;
  barPosition: number;
  layerPhase: number;
  cycleIndex: number;
  cycleBeats: number;
  beatsPerBar: number;
  sampleRate: number;
}

interface MutableVoiceRenderContext {
  sampleRate: number;
  numSamples: number;
  beatPosition: number;
  beatsPerBar: number;
  timeFrame: TimeFrame;
  harmony: HarmonyFrame;
  prevPulseTrigger: number;
}

interface MutableProcessorContext {
  sampleRate: number;
  numSamples: number;
  bpm: number;
  harmony: HarmonyFrame;
  layerPulseEnergy: number;
  layerTrigger: number;
}

/**
 * Renders a single polyrhythmic layer:
 * 1. Evaluates chained TimeOperators (with time-domain modulation)
 * 2. Renders Voice + dynamically ordered ProcessorChain at 8-sample control rate
 *    while preserving ProcessorInstances by card.id across drag-and-drop reorders
 * 3. Applies click-free smoothed level and equal-power stereo panning
 */
export class LayerEngine {
  private sampleRate: number;
  public readonly maxBlockSize: number;
  public readonly bufL: Float32Array;
  public readonly bufR: Float32Array;

  // Pre-allocated sub-block buffers for sizes 1..CONTROL_SUBBLOCK_SIZE (zero allocation).
  private readonly subBufsL: readonly Float32Array[];
  private readonly subBufsR: readonly Float32Array[];
  private readonly secSubBufsL: readonly Float32Array[];
  private readonly secSubBufsR: readonly Float32Array[];

  private config: LayerConfig | null = null;
  private voiceModule: VoiceModule | null = null;
  private voiceInstance: VoiceInstance | null = null;
  private voiceEffectiveParams: Record<string, number> = {};
  private voiceWasModulated = false;

  private secondaryVoiceModule: VoiceModule | null = null;
  private secondaryVoiceInstance: VoiceInstance | null = null;
  private secondaryVoiceEffectiveParams: Record<string, number> = {};
  private secondaryVoiceWasModulated = false;
  private readonly secondaryMixSmoother: OnePoleSmoother;

  private readonly timeOpSlots: TimeOpSlot[] = [];
  private readonly timeOpCache = new Map<string, TimeOpSlot>();
  private readonly processorSlots: ProcessorSlot[] = [];
  private readonly processorCache = new Map<string, ProcessorSlot>();

  private readonly gainLSmoother: OnePoleSmoother;
  private readonly gainRSmoother: OnePoleSmoother;
  private readonly mixBaseParams: Record<string, number> = { level: 0.8, pan: 0 };
  private readonly mixEffectiveParams: Record<string, number> = { level: 0.8, pan: 0 };

  private readonly frameA: MutableTimeFrame = {
    warpedPhase: 0,
    pulseEnergy: 0,
    triggerIntensity: 0,
    accent: 0,
    stepIndex: -1,
    pulseSlope: 0,
  };
  private readonly frameB: MutableTimeFrame = {
    warpedPhase: 0,
    pulseEnergy: 0,
    triggerIntensity: 0,
    accent: 0,
    stepIndex: -1,
    pulseSlope: 0,
  };
  private prevFrame: MutableTimeFrame = this.frameA;
  private prevPulseTrigger = 0;

  private readonly timeCtx: MutableTimeEvalContext;
  private readonly voiceCtx: MutableVoiceRenderContext;
  private readonly procCtx: MutableProcessorContext;

  public lastPhase = 0;
  public lastPulseEnergy = 0;
  public lastTriggerIntensity = 0;

  constructor(sampleRate = 48000, maxBlockSize = DEFAULT_MAX_BLOCK_SIZE) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.maxBlockSize = Math.max(64, maxBlockSize | 0);
    this.bufL = new Float32Array(this.maxBlockSize);
    this.bufR = new Float32Array(this.maxBlockSize);

    const sL: Float32Array[] = [new Float32Array(0)];
    const sR: Float32Array[] = [new Float32Array(0)];
    const secL: Float32Array[] = [new Float32Array(0)];
    const secR: Float32Array[] = [new Float32Array(0)];
    for (let k = 1; k <= CONTROL_SUBBLOCK_SIZE; k++) {
      sL.push(new Float32Array(k));
      sR.push(new Float32Array(k));
      secL.push(new Float32Array(k));
      secR.push(new Float32Array(k));
    }
    this.subBufsL = sL;
    this.subBufsR = sR;
    this.secSubBufsL = secL;
    this.secSubBufsR = secR;

    this.gainLSmoother = new OnePoleSmoother(this.sampleRate, 12, 0);
    this.gainRSmoother = new OnePoleSmoother(this.sampleRate, 12, 0);
    this.secondaryMixSmoother = new OnePoleSmoother(this.sampleRate, 12, 0);

    const dummyHarmony: HarmonyFrame = {
      rootNote: 9,
      rootMidi: 45,
      scaleId: 'natural_minor',
      chordPreset: 'minor7',
      scaleNotesMidi: [],
      chordNotesMidi: [],
    };

    this.timeCtx = {
      beatPosition: 0,
      barPosition: 0,
      layerPhase: 0,
      cycleIndex: 0,
      cycleBeats: 4,
      beatsPerBar: 4,
      sampleRate: this.sampleRate,
    };

    this.voiceCtx = {
      sampleRate: this.sampleRate,
      numSamples: CONTROL_SUBBLOCK_SIZE,
      beatPosition: 0,
      beatsPerBar: 4,
      timeFrame: this.prevFrame,
      harmony: dummyHarmony,
      prevPulseTrigger: 0,
    };

    this.procCtx = {
      sampleRate: this.sampleRate,
      numSamples: CONTROL_SUBBLOCK_SIZE,
      bpm: 130,
      harmony: dummyHarmony,
      layerPulseEnergy: 0,
      layerTrigger: 0,
    };
  }

  public setSampleRate(sr: number): void {
    const nextSr = sanitizeSampleRate(sr);
    if (nextSr === this.sampleRate && this.voiceInstance !== null) return;
    this.sampleRate = nextSr;
    this.gainLSmoother.setSampleRate(this.sampleRate);
    this.gainRSmoother.setSampleRate(this.sampleRate);
    this.secondaryMixSmoother.setSampleRate(this.sampleRate);

    if (this.voiceModule) {
      this.voiceInstance = this.voiceModule.createInstance(this.sampleRate);
    }
    if (this.secondaryVoiceModule) {
      this.secondaryVoiceInstance = this.secondaryVoiceModule.createInstance(this.sampleRate);
    }
    for (const [cardId, slot] of this.processorCache.entries()) {
      const rebuilt: ProcessorSlot = {
        cardId: slot.cardId,
        moduleId: slot.moduleId,
        module: slot.module,
        instance: slot.module.createInstance(this.sampleRate),
        bypassed: slot.bypassed,
        wasModulated: false,
        baseParams: slot.baseParams,
        effectiveParams: { ...slot.effectiveParams },
      };
      this.processorCache.set(cardId, rebuilt);
    }
    for (let i = 0; i < this.processorSlots.length; i++) {
      const cached = this.processorCache.get(this.processorSlots[i]!.cardId);
      if (cached) {
        this.processorSlots[i] = cached;
      }
    }
  }

  public reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.voiceInstance?.reset();
    this.secondaryVoiceInstance?.reset();
    for (const slot of this.processorCache.values()) {
      slot.instance.reset();
    }
    this.gainLSmoother.reset(0);
    this.gainRSmoother.reset(0);
    this.secondaryMixSmoother.reset(0);
    this.frameA.warpedPhase = 0;
    this.frameA.pulseEnergy = 0;
    this.frameA.triggerIntensity = 0;
    this.frameA.accent = 0;
    this.frameA.stepIndex = -1;
    this.frameA.pulseSlope = 0;
    this.frameB.warpedPhase = 0;
    this.frameB.pulseEnergy = 0;
    this.frameB.triggerIntensity = 0;
    this.frameB.accent = 0;
    this.frameB.stepIndex = -1;
    this.frameB.pulseSlope = 0;
    this.prevFrame = this.frameA;
    this.voiceWasModulated = false;
    this.secondaryVoiceWasModulated = false;
    this.prevPulseTrigger = 0;
    this.lastPhase = 0;
    this.lastPulseEnergy = 0;
    this.lastTriggerIntensity = 0;
  }

  /**
   * Synchronizes this LayerEngine to a new `LayerConfig` while reusing existing
   * VoiceInstance and ProcessorInstances keyed by `card.id` so drag-and-drop
   * reordering produces zero audio resets or clicks.
   */
  public syncConfig(config: LayerConfig, registry: ModuleRegistry): void {
    this.config = config;

    // 1. Voice instance (reuse if moduleId matches)
    const nextVoiceMod = registry.getVoice(config.voice.moduleId);
    if (!nextVoiceMod) {
      this.voiceModule = null;
      this.voiceInstance = null;
      this.voiceEffectiveParams = {};
      this.voiceWasModulated = false;
    } else if (this.voiceModule?.id !== nextVoiceMod.id || !this.voiceInstance) {
      this.voiceModule = nextVoiceMod;
      this.voiceInstance = nextVoiceMod.createInstance(this.sampleRate);
      this.voiceEffectiveParams = buildDefaultParams(nextVoiceMod);
      syncStaticParams(nextVoiceMod.parameters, config.voice.params, this.voiceEffectiveParams);
      this.voiceWasModulated = false;
    } else {
      syncStaticParams(nextVoiceMod.parameters, config.voice.params, this.voiceEffectiveParams);
      this.voiceWasModulated = false;
    }

    // 1b. Secondary voice instance (reuse if enabled and moduleId matches)
    const secCfg = config.secondaryVoice;
    const nextSecMod =
      secCfg && secCfg.enabled ? registry.getVoice(secCfg.moduleId) : undefined;
    if (!secCfg || !secCfg.enabled || !nextSecMod) {
      this.secondaryVoiceModule = null;
      this.secondaryVoiceInstance = null;
      this.secondaryVoiceEffectiveParams = {};
      this.secondaryVoiceWasModulated = false;
      this.secondaryMixSmoother.reset(0);
    } else if (
      this.secondaryVoiceModule?.id !== nextSecMod.id ||
      !this.secondaryVoiceInstance
    ) {
      this.secondaryVoiceModule = nextSecMod;
      this.secondaryVoiceInstance = nextSecMod.createInstance(this.sampleRate);
      this.secondaryVoiceEffectiveParams = buildDefaultParams(nextSecMod);
      syncStaticParams(
        nextSecMod.parameters,
        secCfg.params,
        this.secondaryVoiceEffectiveParams,
      );
      this.secondaryVoiceWasModulated = false;
    } else {
      syncStaticParams(
        nextSecMod.parameters,
        secCfg.params,
        this.secondaryVoiceEffectiveParams,
      );
      this.secondaryVoiceWasModulated = false;
    }

    // 2. Time operators
    this.timeOpSlots.length = 0;
    for (let i = 0; i < config.timeOperators.length; i++) {
      const opCfg = config.timeOperators[i]!;
      const opMod = registry.getTimeOperator(opCfg.moduleId);
      if (!opMod) continue;

      let slot = this.timeOpCache.get(opCfg.id);
      if (!slot || slot.moduleId !== opMod.id) {
        slot = {
          id: opCfg.id,
          moduleId: opMod.id,
          module: opMod,
          bypassed: opCfg.bypassed,
          wasModulated: false,
          baseParams: opCfg.params,
          effectiveParams: buildDefaultParams(opMod),
        };
        this.timeOpCache.set(opCfg.id, slot);
      } else {
        slot.bypassed = opCfg.bypassed;
        slot.baseParams = opCfg.params;
        slot.wasModulated = false;
      }
      syncStaticParams(opMod.parameters, opCfg.params, slot.effectiveParams);
      this.timeOpSlots.push(slot);
    }

    // Prune stale time operator cache entries
    for (const cachedId of this.timeOpCache.keys()) {
      let found = false;
      for (let i = 0; i < config.timeOperators.length; i++) {
        if (config.timeOperators[i]!.id === cachedId) {
          found = true;
          break;
        }
      }
      if (!found) {
        this.timeOpCache.delete(cachedId);
      }
    }

    // 3. Processor chain (reuse by card.id so drag-and-drop reorder never clicks!)
    this.processorSlots.length = 0;
    for (let i = 0; i < config.processorChain.length; i++) {
      const cardCfg = config.processorChain[i]!;
      const procMod = registry.getProcessor(cardCfg.moduleId);
      if (!procMod) continue;

      let slot = this.processorCache.get(cardCfg.id);
      if (!slot || slot.moduleId !== procMod.id) {
        slot = {
          cardId: cardCfg.id,
          moduleId: procMod.id,
          module: procMod,
          instance: procMod.createInstance(this.sampleRate),
          bypassed: cardCfg.bypassed,
          wasModulated: false,
          baseParams: cardCfg.params,
          effectiveParams: buildDefaultParams(procMod),
        };
        this.processorCache.set(cardCfg.id, slot);
      } else {
        slot.bypassed = cardCfg.bypassed;
        slot.baseParams = cardCfg.params;
        slot.wasModulated = false;
      }
      syncStaticParams(procMod.parameters, cardCfg.params, slot.effectiveParams);
      this.processorSlots.push(slot);
    }

    // Prune stale processor cache entries
    for (const cachedCardId of this.processorCache.keys()) {
      let found = false;
      for (let i = 0; i < config.processorChain.length; i++) {
        if (config.processorChain[i]!.id === cachedCardId) {
          found = true;
          break;
        }
      }
      if (!found) {
        this.processorCache.delete(cachedCardId);
      }
    }
  }

  /**
   * Renders `numSamples` into `this.bufL` / `this.bufR` (zero allocation).
   */
  public renderBlock(
    startBeat: number,
    numSamples: number,
    tempoBpm: number,
    beatsPerBar: number,
    harmony: HarmonyFrame,
    router: ModulationRouter,
    layerPulsesMap: ReadonlyMap<string, number>,
    audible: boolean,
  ): void {
    const count = Math.min(numSamples | 0, this.maxBlockSize);
    if (count <= 0) return;

    const cfg = this.config;
    if (!cfg) {
      for (let i = 0; i < count; i++) {
        this.bufL[i] = 0;
        this.bufR[i] = 0;
      }
      this.lastPulseEnergy = 0;
      this.lastTriggerIntensity = 0;
      return;
    }

    const level = audible ? clamp(cfg.level, 0, 1.5) : 0;
    const pan = clamp(cfg.pan, -1, 1);
    // Equal-power stereo pan law
    const panAngle = (pan + 1) * (Math.PI * 0.25);
    const targetGainL = level * Math.cos(panAngle);
    const targetGainR = level * Math.sin(panAngle);

    const isFadingOut =
      this.gainLSmoother.current > 1e-6 || this.gainRSmoother.current > 1e-6;
    const shouldRenderDsp = (audible || isFadingOut) && this.voiceInstance !== null;

    const safeBpm = clamp(tempoBpm, 20, 300);
    const samplesPerBeat = (60 / safeBpm) * this.sampleRate;
    const invSamplesPerBeat = 1 / samplesPerBeat;
    const cycleBeats = cycleToBeats(
      cfg.cycleLength.value,
      cfg.cycleLength.unit,
      beatsPerBar,
    );

    if (!cfg.enabled) {
      this.gainLSmoother.reset(0);
      this.gainRSmoother.reset(0);
      this.secondaryMixSmoother.reset(0);
      for (let i = 0; i < count; i++) {
        this.bufL[i] = 0;
        this.bufR[i] = 0;
      }
      this.lastPhase = wrapPhase01((startBeat + count * invSamplesPerBeat) / cycleBeats);
      this.lastPulseEnergy = 0;
      this.lastTriggerIntensity = 0;
      return;
    }

    // If muted/unsoloed and already faded to zero, still advance TimeFrame for
    // UI phase telemetry and ghost sidechains, while skipping heavy voice/FX DSP.
    if (!shouldRenderDsp) {
      this.gainLSmoother.reset(0);
      this.gainRSmoother.reset(0);
      this.secondaryMixSmoother.reset(0);
      for (let i = 0; i < count; i++) {
        this.bufL[i] = 0;
        this.bufR[i] = 0;
      }
      for (let offset = 0; offset < count; offset += CONTROL_SUBBLOCK_SIZE) {
        const subBeat = startBeat + offset * invSamplesPerBeat;
        router.beginLayerSubBlock(cfg, subBeat, beatsPerBar, layerPulsesMap);
        this.evaluateTimeChain(cfg, subBeat, beatsPerBar, cycleBeats, router);
      }
      return;
    }

    const voiceInst = this.voiceInstance!;
    const voiceMod = this.voiceModule!;
    const gainLSmoother = this.gainLSmoother;
    const gainRSmoother = this.gainRSmoother;
    const outL = this.bufL;
    const outR = this.bufR;
    const hasMixMod = audible && router.hasTargetRoutes(cfg, 'voice', 'layer-mix');

    for (let offset = 0; offset < count; offset += CONTROL_SUBBLOCK_SIZE) {
      const subLen = Math.min(CONTROL_SUBBLOCK_SIZE, count - offset);
      const subBeat = startBeat + offset * invSamplesPerBeat;

      // 1. Evaluate 1-pass modulation signals for this control sub-block
      router.beginLayerSubBlock(cfg, subBeat, beatsPerBar, layerPulsesMap);

      // 2. Evaluate TimeOperators (with modulated time parameters)
      const timeFrame = this.evaluateTimeChain(
        cfg,
        subBeat,
        beatsPerBar,
        cycleBeats,
        router,
      );

      // 3. Modulate Voice parameters (only if targeted) and render sub-block
      if (router.hasTargetRoutes(cfg, 'voice', 'voice', voiceMod.id)) {
        router.applyTargetModulation(
          cfg,
          'voice',
          'voice',
          voiceMod.id,
          voiceMod.parameters,
          cfg.voice.params,
          this.voiceEffectiveParams,
        );
        this.voiceWasModulated = true;
      } else if (this.voiceWasModulated) {
        syncStaticParams(voiceMod.parameters, cfg.voice.params, this.voiceEffectiveParams);
        this.voiceWasModulated = false;
      }

      const subL = this.subBufsL[subLen]!;
      const subR = this.subBufsR[subLen]!;
      subL.fill(0);
      subR.fill(0);

      this.voiceCtx.sampleRate = this.sampleRate;
      this.voiceCtx.numSamples = subLen;
      this.voiceCtx.beatPosition = subBeat;
      this.voiceCtx.beatsPerBar = beatsPerBar;
      this.voiceCtx.timeFrame = timeFrame;
      this.voiceCtx.harmony = harmony;
      this.voiceCtx.prevPulseTrigger = this.prevPulseTrigger;

      voiceInst.process(
        subL,
        subR,
        this.voiceEffectiveParams,
        this.voiceCtx as VoiceRenderContext,
      );

      // 3b. Render optional secondary voice and equal-power blend before updating prevPulseTrigger
      const secCfg = cfg.secondaryVoice;
      const secInst = this.secondaryVoiceInstance;
      const secMod = this.secondaryVoiceModule;
      if (
        secCfg?.enabled &&
        secInst !== null &&
        secMod !== null &&
        (secCfg.mix > 0.001 || Math.abs(this.secondaryMixSmoother.current) > 0.001)
      ) {
        if (router.hasTargetRoutes(cfg, 'voice', 'secondary-voice')) {
          router.applyTargetModulation(
            cfg,
            'voice',
            'secondary-voice',
            undefined,
            secMod.parameters,
            secCfg.params,
            this.secondaryVoiceEffectiveParams,
          );
          this.secondaryVoiceWasModulated = true;
        } else if (this.secondaryVoiceWasModulated) {
          syncStaticParams(
            secMod.parameters,
            secCfg.params,
            this.secondaryVoiceEffectiveParams,
          );
          this.secondaryVoiceWasModulated = false;
        }

        const secSubL = this.secSubBufsL[subLen]!;
        const secSubR = this.secSubBufsR[subLen]!;
        secSubL.fill(0);
        secSubR.fill(0);

        secInst.process(
          secSubL,
          secSubR,
          this.secondaryVoiceEffectiveParams,
          this.voiceCtx as VoiceRenderContext,
        );

        const targetMix = clamp(secCfg.mix, 0, 1);
        for (let i = 0; i < subLen; i++) {
          const m = this.secondaryMixSmoother.process(targetMix);
          const angle = m * HALF_PI;
          const gPrimary = Math.cos(angle);
          const gSecondary = Math.sin(angle);
          subL[i] = subL[i]! * gPrimary + secSubL[i]! * gSecondary;
          subR[i] = subR[i]! * gPrimary + secSubR[i]! * gSecondary;
        }
        if (Math.abs(this.secondaryMixSmoother.current - targetMix) < 1e-6) {
          this.secondaryMixSmoother.reset(targetMix);
        }
      } else {
        this.secondaryMixSmoother.reset(0);
      }

      this.prevPulseTrigger = timeFrame.triggerIntensity;

      // 4. Process dynamically ordered ProcessorChain (with modulated processor parameters)
      this.procCtx.sampleRate = this.sampleRate;
      this.procCtx.numSamples = subLen;
      this.procCtx.bpm = safeBpm;
      this.procCtx.harmony = harmony;
      this.procCtx.layerPulseEnergy = timeFrame.pulseEnergy;
      this.procCtx.layerTrigger = timeFrame.triggerIntensity;

      for (let p = 0; p < this.processorSlots.length; p++) {
        const slot = this.processorSlots[p]!;
        if (slot.bypassed) continue;

        if (router.hasTargetRoutes(cfg, 'processor', slot.cardId, slot.moduleId)) {
          router.applyTargetModulation(
            cfg,
            'processor',
            slot.cardId,
            slot.moduleId,
            slot.module.parameters,
            slot.baseParams,
            slot.effectiveParams,
          );
          slot.wasModulated = true;
        } else if (slot.wasModulated) {
          syncStaticParams(slot.module.parameters, slot.baseParams, slot.effectiveParams);
          slot.wasModulated = false;
        }

        slot.instance.process(
          subL,
          subR,
          slot.effectiveParams,
          this.procCtx as ProcessorContext,
        );
      }

      // 5. Apply smoothed level & equal-power pan into layer output buffer
      let subTargetGainL = targetGainL;
      let subTargetGainR = targetGainR;
      if (hasMixMod) {
        this.mixBaseParams.level = cfg.level;
        this.mixBaseParams.pan = cfg.pan;
        router.applyTargetModulation(
          cfg,
          'voice',
          'layer-mix',
          undefined,
          LAYER_MIX_PARAMETERS,
          this.mixBaseParams,
          this.mixEffectiveParams,
        );
        const modLevel = clamp(this.mixEffectiveParams.level ?? cfg.level, 0, 1.5);
        const modPan = clamp(this.mixEffectiveParams.pan ?? cfg.pan, -1, 1);
        const modPanAngle = (modPan + 1) * (HALF_PI * 0.5);
        subTargetGainL = modLevel * Math.cos(modPanAngle);
        subTargetGainR = modLevel * Math.sin(modPanAngle);
      }

      if (gainLSmoother.current === subTargetGainL && gainRSmoother.current === subTargetGainR) {
        for (let i = 0; i < subLen; i++) {
          const l = subL[i]!;
          const r = subR[i]!;
          outL[offset + i] =
            (l * 0 === 0 && (l > 1e-18 || l < -1e-18) ? l : 0) * subTargetGainL;
          outR[offset + i] =
            (r * 0 === 0 && (r > 1e-18 || r < -1e-18) ? r : 0) * subTargetGainR;
        }
      } else {
        for (let i = 0; i < subLen; i++) {
          const gL = gainLSmoother.process(subTargetGainL);
          const gR = gainRSmoother.process(subTargetGainR);
          const l = subL[i]!;
          const r = subR[i]!;
          outL[offset + i] = (l * 0 === 0 && (l > 1e-18 || l < -1e-18) ? l : 0) * gL;
          outR[offset + i] = (r * 0 === 0 && (r > 1e-18 || r < -1e-18) ? r : 0) * gR;
        }
        if (Math.abs(gainLSmoother.current - subTargetGainL) < 1e-6) {
          gainLSmoother.reset(subTargetGainL);
        }
        if (Math.abs(gainRSmoother.current - subTargetGainR) < 1e-6) {
          gainRSmoother.reset(subTargetGainR);
        }
      }
    }
  }

  private evaluateTimeChain(
    cfg: LayerConfig,
    beatPosition: number,
    beatsPerBar: number,
    cycleBeats: number,
    router: ModulationRouter,
  ): TimeFrame {
    const rawPhase = wrapPhase01(beatPosition / cycleBeats);
    const barPosition = beatPosition / beatsPerBar;
    const cycleIndex = Math.floor(beatPosition / cycleBeats);

    this.timeCtx.beatPosition = beatPosition;
    this.timeCtx.barPosition = barPosition;
    this.timeCtx.layerPhase = rawPhase;
    this.timeCtx.cycleIndex = cycleIndex;
    this.timeCtx.cycleBeats = cycleBeats;
    this.timeCtx.beatsPerBar = beatsPerBar;
    this.timeCtx.sampleRate = this.sampleRate;

    const prevStepIndex = this.prevFrame.stepIndex;
    let cur: MutableTimeFrame =
      this.prevFrame === this.frameA ? this.frameB : this.frameA;
    let next: MutableTimeFrame = this.prevFrame;

    cur.warpedPhase = rawPhase;
    cur.pulseEnergy = this.prevFrame.pulseEnergy;
    cur.triggerIntensity = 0;
    cur.accent = this.prevFrame.accent;
    cur.stepIndex = prevStepIndex;
    cur.pulseSlope = this.prevFrame.pulseSlope ?? 0;

    let hasPulseGenerator = false;

    for (let i = 0; i < this.timeOpSlots.length; i++) {
      const slot = this.timeOpSlots[i]!;
      if (slot.bypassed) continue;

      if (slot.moduleId === 'time-pulse-interference') {
        hasPulseGenerator = true;
      }

      if (router.hasTargetRoutes(cfg, 'time', slot.id, slot.moduleId)) {
        router.applyTargetModulation(
          cfg,
          'time',
          slot.id,
          slot.moduleId,
          slot.module.parameters,
          slot.baseParams,
          slot.effectiveParams,
        );
        slot.wasModulated = true;
      } else if (slot.wasModulated) {
        syncStaticParams(slot.module.parameters, slot.baseParams, slot.effectiveParams);
        slot.wasModulated = false;
      }

      if (slot.module.evaluateTimeInto) {
        slot.module.evaluateTimeInto(
          this.timeCtx as TimeEvalContext,
          slot.effectiveParams,
          cur,
          next,
        );
      } else {
        const res = slot.module.evaluateTime(
          this.timeCtx as TimeEvalContext,
          slot.effectiveParams,
          cur,
        );
        next.warpedPhase = res.warpedPhase;
        next.pulseEnergy = res.pulseEnergy;
        next.triggerIntensity = res.triggerIntensity;
        next.accent = res.accent;
        next.stepIndex = res.stepIndex;
        next.pulseSlope = res.pulseSlope ?? 0;
      }
      const tmp = cur;
      cur = next;
      next = tmp;
    }

    if (!hasPulseGenerator) {
      cur.pulseEnergy = 1;
      cur.triggerIntensity = 0;
      cur.accent = 1;
      cur.stepIndex = 0;
      cur.pulseSlope = 0;
    }

    this.prevFrame = cur;
    this.lastPhase = cur.warpedPhase;
    this.lastPulseEnergy = cur.pulseEnergy;
    this.lastTriggerIntensity = cur.triggerIntensity;

    return cur;
  }
}
