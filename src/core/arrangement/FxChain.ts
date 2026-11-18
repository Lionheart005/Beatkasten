/**
 * Effect chain for timeline tracks and the song master. Reuses the processor
 * cards of the Beatkasten (same registry). Instances are kept by card.id so
 * live edits never reset delay / reverb tails. Processing runs in 32-sample
 * control blocks so keyframe automation can move any card parameter.
 */
import { clampParam, type HarmonyFrame, type ProcessorContext, type ProcessorInstance, type ProcessorModule } from '../registry/types';
import type { ModuleRegistry } from '../registry/ModuleRegistry';
import type { ProcessorCardConfig } from '../state/types';
import type { LaneEvaluator } from './automation';

export const FX_CONTROL_BLOCK = 32;

interface FxSlot {
  cardId: string;
  moduleId: string;
  module: ProcessorModule;
  instance: ProcessorInstance;
  bypassed: boolean;
  base: Record<string, number>;
  effective: Record<string, number>;
}

interface FxBinding {
  slot: FxSlot;
  paramId: string;
  evaluator: LaneEvaluator;
}

/** Neutral harmony for effects outside of a section (A minor, no chord motion). */
export const NEUTRAL_HARMONY: HarmonyFrame = {
  rootNote: 9,
  rootMidi: 33,
  keyRootMidi: 33,
  scaleId: 'natural_minor',
  chordPreset: 'minor',
  scaleNotesMidi: [],
  chordNotesMidi: [57, 60, 64],
  bassMidi: 33,
  bassRest: false,
  stepIndex: 0,
};

interface MutableCtx {
  sampleRate: number;
  numSamples: number;
  bpm: number;
  harmony: HarmonyFrame;
  layerPulseEnergy: number;
  layerTrigger: number;
}

export class FxChain {
  private sampleRate: number;
  private readonly registry: ModuleRegistry;
  private readonly cache = new Map<string, FxSlot>();
  private slots: FxSlot[] = [];
  private bindings: FxBinding[] = [];
  private readonly scratchL = new Float32Array(FX_CONTROL_BLOCK);
  private readonly scratchR = new Float32Array(FX_CONTROL_BLOCK);
  private readonly ctx: MutableCtx;

  constructor(sampleRate: number, registry: ModuleRegistry) {
    this.sampleRate = sampleRate;
    this.registry = registry;
    this.ctx = {
      sampleRate,
      numSamples: FX_CONTROL_BLOCK,
      bpm: 130,
      harmony: NEUTRAL_HARMONY,
      layerPulseEnergy: 0,
      layerTrigger: 0,
    };
  }

  public get isEmpty(): boolean {
    return this.slots.length === 0;
  }

  /** Syncs to a card list (instances reused by card id). Not for the audio hot path. */
  public sync(cards: readonly ProcessorCardConfig[]): void {
    const next: FxSlot[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      const mod = this.registry.getProcessor(card.moduleId);
      if (!mod || seen.has(card.id)) continue;
      seen.add(card.id);
      let slot = this.cache.get(card.id);
      if (!slot || slot.moduleId !== card.moduleId) {
        slot = {
          cardId: card.id,
          moduleId: card.moduleId,
          module: mod,
          instance: mod.createInstance(this.sampleRate),
          bypassed: false,
          base: {},
          effective: {},
        };
        this.cache.set(card.id, slot);
      }
      slot.bypassed = card.bypassed;
      for (const p of mod.parameters) {
        const v = clampParam(p, card.params[p.id] ?? p.defaultValue);
        slot.base[p.id] = v;
        slot.effective[p.id] = v;
      }
      next.push(slot);
    }
    for (const id of [...this.cache.keys()]) if (!seen.has(id)) this.cache.delete(id);
    this.slots = next;
    this.bindings = [];
  }

  /** Binds a keyframe lane to a card parameter (call after sync). Returns false if unknown. */
  public bind(cardId: string, paramId: string, evaluator: LaneEvaluator): boolean {
    const slot = this.slots.find((s) => s.cardId === cardId);
    const schema = slot?.module.parameters.find((p) => p.id === paramId);
    if (!slot || !schema) return false;
    this.bindings.push({ slot, paramId, evaluator });
    return true;
  }

  /** Parameter schema of a card in this chain (for clamping automation). */
  public paramRange(cardId: string, paramId: string): { min: number; max: number } | null {
    const slot = this.slots.find((s) => s.cardId === cardId);
    const p = slot?.module.parameters.find((x) => x.id === paramId);
    return p ? { min: p.min, max: p.max } : null;
  }

  public reset(): void {
    for (const s of this.slots) s.instance.reset();
  }

  /**
   * Processes `count` samples in place starting at `offset`. `startBeat` and
   * `beatsPerSample` drive the keyframe automation.
   */
  public process(
    bufL: Float32Array,
    bufR: Float32Array,
    offset: number,
    count: number,
    bpm: number,
    startBeat: number,
    beatsPerSample: number,
  ): void {
    const slots = this.slots;
    if (slots.length === 0) return;
    const ctx = this.ctx;
    ctx.bpm = bpm;
    const sL = this.scratchL;
    const sR = this.scratchR;
    const bindings = this.bindings;
    for (let o = 0; o < count; o += FX_CONTROL_BLOCK) {
      const len = Math.min(FX_CONTROL_BLOCK, count - o);
      if (bindings.length > 0) {
        const beat = startBeat + o * beatsPerSample;
        for (let b = 0; b < bindings.length; b++) {
          const bd = bindings[b]!;
          const v = bd.evaluator.value(beat);
          if (v === v) bd.slot.effective[bd.paramId] = v;
        }
      }
      const base = offset + o;
      for (let i = 0; i < len; i++) {
        sL[i] = bufL[base + i]!;
        sR[i] = bufR[base + i]!;
      }
      ctx.numSamples = len;
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s]!;
        if (slot.bypassed) continue;
        slot.instance.process(sL, sR, slot.effective, ctx as ProcessorContext);
      }
      for (let i = 0; i < len; i++) {
        bufL[base + i] = sL[i]!;
        bufR[base + i] = sR[i]!;
      }
    }
  }
}
