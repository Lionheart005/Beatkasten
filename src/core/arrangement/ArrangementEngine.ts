/**
 * ArrangementEngine — plays the timeline (pure TS, identical live and offline).
 *
 *  Section clip ─► SectionPlayer (dry TechnoEngine) ─► clip envelope ─┐
 *  Audio clip   ─► audio reader (offset, gain, fades, reverse) ───────┼─► track sum ─► track FX ─► level/pan/mute/solo ─┐
 *                                                                     │                                                ├─► master FX ─► MasterBus
 *
 * Compile step (on every document change, may allocate):
 *  - clips are grouped into CHAINS: a clip that starts exactly where a clip of
 *    the same section ends and continues its loop offset keeps the same player
 *    (seamless split). Identical-sounding neighbours are merged into one
 *    SEGMENT, so a split clip renders bit-identically to the unsplit one.
 *  - overlapping clips on one track get automatic equal-power crossfades.
 *  - all segment edges + tempo changes form a sorted event list; render chunks
 *    never straddle an event (sample-accurate boundaries).
 * Render step: zero allocations.
 */
import { defaultRegistry } from '../defaultRegistry';
import { MasterBus } from '../dsp/masterBus';
import { OnePoleSmoother } from '../dsp/smoothing';
import { TechnoEngine } from '../engine/TechnoEngine';
import type { ModuleRegistry } from '../registry/ModuleRegistry';
import type { BeatSnapshot, ModulationRouteConfig } from '../state/types';
import type { ParameterSchema } from '../registry/types';
import { LaneEvaluator } from './automation';
import { clipSoundKey, deriveClipSnapshot, freezeKeyForDoc } from './clipSnapshot';
import { FxChain } from './FxChain';
import { TempoMap } from './tempoMap';
import {
  clipEndBeat,
  type ArrangementClip,
  type ArrangementDoc,
  type AutomationLane,
  type FadeShape,
  type SectionClip,
} from './types';

const DEFAULT_MAX_BLOCK = 1024;
/** Anti-click fade at hard clip edges. */
const MIN_EDGE_FADE_SEC = 0.0015;
const EPS_BEATS = 1e-6;

/** PCM data of an audio asset (already at any sample rate; read with interpolation). */
export interface AudioAssetData {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly length: number;
}

export type AudioAssetLookup = (assetId: string) => AudioAssetData | undefined;

export interface ArrangementEngineOptions {
  /** Max. simultaneously playing section clips (live CPU budget). */
  readonly maxPlayers?: number;
  readonly maxBlockSize?: number;
  readonly registry?: ModuleRegistry;
  /** Honour doc.loop (live playback only). */
  readonly useLoop?: boolean;
  /**
   * 'master' (default) = full song; 'pre-master' = tracks with FX but without
   * master FX / limiter (bounce); 'raw-clips' = clip signals only (freeze).
   */
  readonly outputStage?: 'master' | 'pre-master' | 'raw-clips';
}

const SHAPE_CODE: Readonly<Record<FadeShape, number>> = {
  linear: 0,
  'equal-power': 1,
  exp: 2,
  's-curve': 3,
};

/** Fade gain for progress t in 0..1 (0 = silent, 1 = full). */
function fadeGain(shape: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (shape) {
    case 1:
      return Math.sin(t * Math.PI * 0.5);
    case 2:
      return t * t;
    case 3:
      return 0.5 - 0.5 * Math.cos(t * Math.PI);
    default:
      return t;
  }
}

export interface CompiledSegment {
  readonly kind: 'section' | 'audio';
  readonly trackIndex: number;
  readonly chain: number;
  readonly clipIds: readonly string[];
  readonly startBeat: number;
  readonly endBeat: number;
  readonly startSample: number;
  readonly endSample: number;
  /** Section clips: loop beat at segment start. */
  readonly offsetBeats: number;
  readonly snapshot: BeatSnapshot | null;
  /** Audio clips. */
  readonly assetId: string;
  readonly sourceOffsetSec: number;
  readonly reversed: boolean;
  readonly gain: number;
  readonly fadeInBeats: number;
  readonly fadeInShape: number;
  readonly fadeOutBeats: number;
  readonly fadeOutShape: number;
  /** Edge is not a seamless continuation → anti-click fade. */
  readonly hardStart: boolean;
  readonly hardEnd: boolean;
  /** Clip tail: after endSample the voices are silent, cards ring out until here. */
  readonly tailEndSample: number;
  /** Keyframe lanes on layers of this clip (beats relative to clipStartBeat). */
  readonly layerLanes: readonly CompiledLayerLanes[];
  readonly paramLanes: readonly CompiledParamLane[];
}

/** Keyframes on any layer control, fed into an 'external' modulation slot. */
export interface CompiledParamLane {
  readonly slot: number;
  readonly clipStartBeat: number;
  readonly base: number;
  readonly span: number;
  readonly evaluator: LaneEvaluator;
}

export interface CompiledLayerLanes {
  readonly layerIndex: number;
  readonly clipStartBeat: number;
  readonly level: LaneEvaluator | null;
  readonly pan: LaneEvaluator | null;
  readonly enabled: LaneEvaluator | null;
}

export interface CompiledTrack {
  readonly id: string;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly level: number;
  readonly pan: number;
}

export interface CompiledArrangement {
  readonly tempoMap: TempoMap;
  readonly tracks: readonly CompiledTrack[];
  readonly segments: readonly CompiledSegment[];
  readonly chainCount: number;
  /** Chain key (first clip id) per chain, used to keep players across recompiles. */
  readonly chainKeys: readonly string[];
  /** Sorted unique event sample positions. */
  readonly events: Float64Array;
  readonly anySolo: boolean;
  readonly endSample: number;
  readonly endBeat: number;
}

interface WorkClip {
  clip: ArrangementClip;
  start: number;
  end: number;
  fadeIn: number;
  fadeInShape: number;
  fadeOut: number;
  fadeOutShape: number;
  chain: number;
  /** Continues the previous clip of its chain seamlessly. */
  seamlessFromPrev: boolean;
  seamlessToNext: boolean;
  soundKey: string;
}

function isContinuation(a: ArrangementClip, b: ArrangementClip): boolean {
  if (a.kind !== 'section' || b.kind !== 'section') return false;
  if (a.sectionId !== b.sectionId) return false;
  if (Math.abs(clipEndBeat(a) - b.startBeat) > EPS_BEATS) return false;
  if (Math.abs(a.sourceOffsetBeats + a.lengthBeats - b.sourceOffsetBeats) > EPS_BEATS) return false;
  if (a.fadeOut.beats > EPS_BEATS || b.fadeIn.beats > EPS_BEATS) return false;
  if ((a.transposeSemitones ?? 0) !== (b.transposeSemitones ?? 0)) return false;
  return true;
}

/**
 * Compiles a document into flat render data. `sections` maps section id → its
 * current snapshot (live reference: Beatkasten edits are heard immediately).
 */
export function compileArrangement(
  doc: ArrangementDoc,
  sections: ReadonlyMap<string, BeatSnapshot>,
  sampleRate: number,
  hasAsset: (assetId: string) => boolean = () => false,
): CompiledArrangement {
  const tempoMap = new TempoMap(doc.tempoMarkers, doc.meterMarkers);
  const tracks: CompiledTrack[] = [];
  const segments: CompiledSegment[] = [];
  const chainKeys: string[] = [];
  const eventSet = new Set<number>();
  let anySolo = false;
  let endBeat = 0;

  // Clip-layer keyframe lanes by clip id.
  const clipLanes = new Map<string, Array<{ layerId: string; param: 'level' | 'pan' | 'enabled'; points: AutomationLane['points'] }>>();
  for (const lane of doc.automation) {
    if (!lane.enabled || lane.points.length === 0 || lane.target.scope !== 'clip-layer') continue;
    const list = clipLanes.get(lane.target.clipId) ?? [];
    list.push({ layerId: lane.target.layerId, param: lane.target.param, points: lane.points });
    clipLanes.set(lane.target.clipId, list);
  }
  const clipParamLanes = new Map<string, Array<Extract<AutomationLane['target'], { scope: 'clip-layer-param' }> & { points: AutomationLane['points'] }>>();
  for (const lane of doc.automation) {
    if (!lane.enabled || lane.points.length === 0 || lane.target.scope !== 'clip-layer-param') continue;
    const list = clipParamLanes.get(lane.target.clipId) ?? [];
    list.push({ ...lane.target, points: lane.points });
    clipParamLanes.set(lane.target.clipId, list);
  }

  doc.tracks.forEach((track, trackIndex) => {
    tracks.push({
      id: track.id,
      muted: track.muted,
      solo: track.solo,
      level: track.level,
      pan: track.pan,
    });
    if (track.solo) anySolo = true;

    const clips = track.clips
      .filter((c) => !c.muted && c.lengthBeats > EPS_BEATS && c.kind === track.kind)
      .slice()
      .sort((a, b) => a.startBeat - b.startBeat);

    // 1) chains (seamless continuation keeps one player)
    const work: WorkClip[] = [];
    const openChains: Array<{ chain: number; last: WorkClip }> = [];
    for (const clip of clips) {
      const w: WorkClip = {
        clip,
        start: clip.startBeat,
        end: clipEndBeat(clip),
        fadeIn: Math.max(0, clip.fadeIn.beats),
        fadeInShape: SHAPE_CODE[clip.fadeIn.shape] ?? 1,
        fadeOut: Math.max(0, clip.fadeOut.beats),
        fadeOutShape: SHAPE_CODE[clip.fadeOut.shape] ?? 1,
        chain: -1,
        seamlessFromPrev: false,
        seamlessToNext: false,
        // Clips with own layer keyframes are never merged with their neighbours.
        soundKey:
          clip.kind === 'section'
            ? clipSoundKey(clip) +
              (clipLanes.has(clip.id) || clipParamLanes.has(clip.id) || clip.frozenAssetId ? `|${clip.id}` : '')
            : '',
      };
      const open = openChains.find((o) => !o.last.seamlessToNext && isContinuation(o.last.clip, clip));
      if (open) {
        w.chain = open.chain;
        w.seamlessFromPrev = true;
        open.last.seamlessToNext = true;
        open.last = w;
      } else {
        w.chain = chainKeys.length;
        chainKeys.push(clip.id);
        openChains.push({ chain: w.chain, last: w });
      }
      work.push(w);
      endBeat = Math.max(endBeat, w.end);
    }

    // 2) automatic equal-power crossfades where clips overlap on this track
    for (let i = 0; i < work.length; i++) {
      const a = work[i]!;
      for (let j = i + 1; j < work.length; j++) {
        const b = work[j]!;
        if (b.start >= a.end - EPS_BEATS) break;
        if (a.chain === b.chain) continue;
        const overlap = Math.min(a.end, b.end) - b.start;
        if (overlap <= EPS_BEATS) continue;
        if (!b.seamlessFromPrev && b.fadeIn < overlap) {
          b.fadeIn = overlap;
          b.fadeInShape = 1;
        }
        if (!a.seamlessToNext && b.end >= a.end && a.fadeOut < overlap) {
          a.fadeOut = overlap;
          a.fadeOutShape = 1;
        }
      }
    }

    // 3) segments: merge seamless neighbours that sound identical
    for (let i = 0; i < work.length; i++) {
      const first = work[i]!;
      let last = first;
      const ids = [first.clip.id];
      while (true) {
        const nextIdx = work.findIndex(
          (w, k) => k > i && w.chain === last.chain && w.seamlessFromPrev && Math.abs(w.start - last.end) < EPS_BEATS,
        );
        if (nextIdx < 0) break;
        const nxt = work[nextIdx]!;
        if (!last.seamlessToNext || nxt.soundKey !== first.soundKey) break;
        ids.push(nxt.clip.id);
        last = nxt;
        work.splice(nextIdx, 1);
      }
      const startSample = tempoMap.beatToSample(first.start, sampleRate);
      const endSample = tempoMap.beatToSample(last.end, sampleRate);
      if (endSample <= startSample) continue;
      const clip = first.clip;
      let snapshot: BeatSnapshot | null = null;
      // Frozen section clip with an up-to-date render → plays as audio.
      let frozenAsset = '';
      if (clip.kind === 'section') {
        const src = sections.get(clip.sectionId);
        snapshot = src ? deriveClipSnapshot(src, clip, tempoMap.bpmAt(first.start)) : null;
        if (
          src &&
          ids.length === 1 &&
          clip.frozenAssetId &&
          clip.frozenKey &&
          hasAsset(clip.frozenAssetId) &&
          freezeKeyForDoc(doc, clip, src) === clip.frozenKey
        ) {
          frozenAsset = clip.frozenAssetId;
        }
      }
      const tailBeats =
        !last.seamlessToNext && last.clip.kind === 'section' ? Math.max(0, Math.min(64, last.clip.tailBeats ?? 0)) : 0;
      const tailEndSample = tailBeats > 0 ? tempoMap.beatToSample(last.end + tailBeats, sampleRate) : endSample;
      endBeat = Math.max(endBeat, last.end + tailBeats);
      const layerLanes: CompiledLayerLanes[] = [];
      const paramLanes: CompiledParamLane[] = [];
      const paramOfClip = clipParamLanes.get(clip.id);
      if (paramOfClip && snapshot && !frozenAsset) {
        const injected = new Map<string, ModulationRouteConfig[]>();
        paramOfClip.slice(0, 64).forEach((l, slot) => {
          const layer = snapshot!.layers.find((x) => x.id === l.layerId);
          if (!layer) return;
          let schema: ParameterSchema | undefined;
          let base = 0;
          if (l.domain === 'voice') {
            schema = defaultRegistry.getVoice(layer.voice.moduleId)?.parameters.find((p) => p.id === l.paramId);
            base = schema ? (layer.voice.params[l.paramId] ?? schema.defaultValue) : 0;
          } else {
            const card = layer.processorChain.find((c) => c.id === l.cardId);
            schema = card ? defaultRegistry.getProcessor(card.moduleId)?.parameters.find((p) => p.id === l.paramId) : undefined;
            base = schema && card ? (card.params[l.paramId] ?? schema.defaultValue) : 0;
          }
          if (!schema || !schema.modulatable) return;
          const span = schema.max - schema.min || 1;
          paramLanes.push({ slot, clipStartBeat: clip.startBeat, base, span, evaluator: new LaneEvaluator(l.points, schema.min, schema.max) });
          const routes = injected.get(layer.id) ?? [];
          routes.push({
            id: `timeline-ext-${slot}`,
            enabled: true,
            sourceType: 'external',
            sourceConfig: { externalSlot: slot },
            targetDomain: l.domain,
            targetCardId: l.domain === 'voice' ? 'voice' : l.cardId,
            targetParamId: l.paramId,
            combineMode: 'add',
            depth: 1,
          });
          injected.set(layer.id, routes);
        });
        if (injected.size > 0) {
          snapshot = {
            ...snapshot,
            layers: snapshot.layers.map((ly) => {
              const extra = injected.get(ly.id);
              return extra ? { ...ly, modulations: [...ly.modulations, ...extra] } : ly;
            }),
          };
        }
      }
      const lanesOfClip = clipLanes.get(clip.id);
      if (lanesOfClip && snapshot) {
        const byLayer = new Map<number, { level: LaneEvaluator | null; pan: LaneEvaluator | null; enabled: LaneEvaluator | null }>();
        for (const l of lanesOfClip) {
          const idx = snapshot.layers.findIndex((x) => x.id === l.layerId);
          if (idx < 0) continue;
          const entry = byLayer.get(idx) ?? { level: null, pan: null, enabled: null };
          if (l.param === 'level') entry.level = new LaneEvaluator(l.points, 0, 1.5);
          else if (l.param === 'pan') entry.pan = new LaneEvaluator(l.points, -1, 1);
          else entry.enabled = new LaneEvaluator(l.points, 0, 1);
          byLayer.set(idx, entry);
        }
        for (const [layerIndex, e] of byLayer) layerLanes.push({ layerIndex, clipStartBeat: clip.startBeat, ...e });
      }
      segments.push({
        kind: frozenAsset ? 'audio' : clip.kind,
        trackIndex,
        chain: first.chain,
        clipIds: ids,
        startBeat: first.start,
        endBeat: last.end,
        startSample,
        endSample,
        offsetBeats: clip.kind === 'section' ? Math.max(0, clip.sourceOffsetBeats) : 0,
        snapshot,
        assetId: frozenAsset || (clip.kind === 'audio' ? clip.assetId : ''),
        sourceOffsetSec: clip.kind === 'audio' ? Math.max(0, clip.sourceOffsetSec) : 0,
        reversed: clip.kind === 'audio' && clip.reversed === true,
        gain: Math.min(2, Math.max(0, Number.isFinite(clip.gain) ? clip.gain : 1)),
        fadeInBeats: first.fadeIn,
        fadeInShape: first.fadeInShape,
        fadeOutBeats: last.fadeOut,
        fadeOutShape: last.fadeOutShape,
        hardStart: !first.seamlessFromPrev,
        hardEnd: !last.seamlessToNext,
        tailEndSample,
        layerLanes,
        paramLanes,
      });
      eventSet.add(startSample);
      eventSet.add(endSample);
      if (tailEndSample > endSample) eventSet.add(tailEndSample);
    }
  });

  for (let i = 1; i < tempoMap.tempoMarkerCount; i++) {
    eventSet.add(tempoMap.beatToSample(tempoMap.tempoMarkerBeat(i), sampleRate));
  }
  if (doc.loop && doc.loop.enabled && doc.loop.endBeat > doc.loop.startBeat) {
    eventSet.add(tempoMap.beatToSample(doc.loop.endBeat, sampleRate));
  }
  const events = Float64Array.from([...eventSet].sort((a, b) => a - b));
  return {
    tempoMap,
    tracks,
    segments,
    chainCount: chainKeys.length,
    chainKeys,
    events,
    anySolo,
    endSample: tempoMap.beatToSample(endBeat, sampleRate),
    endBeat,
  };
}

interface TrackBus {
  id: string;
  fx: FxChain;
  bufL: Float32Array;
  bufR: Float32Array;
  gainL: OnePoleSmoother;
  gainR: OnePoleSmoother;
  levelEval: LaneEvaluator | null;
  panEval: LaneEvaluator | null;
  hasSignal: boolean;
  peak: number;
}

export interface ArrangementTelemetry {
  songBeat: number;
  /** Peak per track since the last read (index = track order). */
  trackPeaks: Float32Array;
  masterPeak: number;
  activePlayers: number;
  /** True when a clip could not play because all players were busy. */
  playerLimitHit: boolean;
}

export class ArrangementEngine {
  private readonly sampleRate: number;
  private readonly registry: ModuleRegistry;
  private readonly maxBlock: number;
  private readonly useLoop: boolean;
  private readonly outputStage: 'master' | 'pre-master' | 'raw-clips';
  private sectionsRef: ReadonlyMap<string, BeatSnapshot> = new Map();

  private compiled: CompiledArrangement;
  private doc: ArrangementDoc | null = null;
  private assets: AudioAssetLookup = () => undefined;

  // Players
  private readonly playerPool: TechnoEngine[] = [];
  private readonly freePlayers: TechnoEngine[] = [];
  private chainPlayer: Array<TechnoEngine | null> = [];
  private chainSnapshot: Array<BeatSnapshot | null> = [];
  private chainStamp: Int32Array = new Int32Array(0);
  private stamp = 0;

  // Buses
  private trackBuses: TrackBus[] = [];
  private readonly busCache = new Map<string, TrackBus>();
  private readonly masterFx: FxChain;
  private readonly masterBus: MasterBus;
  private masterGainEval: LaneEvaluator | null = null;
  private masterGlueEval: LaneEvaluator | null = null;
  private readonly mixL: Float32Array;
  private readonly mixR: Float32Array;
  private readonly tmpL: Float32Array;
  private readonly tmpR: Float32Array;

  // Transport
  private samplePos = 0;
  private eventCursor = 0;
  private loopStartSample = 0;
  private loopEndSample = -1;

  private readonly telemetry: ArrangementTelemetry;

  // Metronome (count-in / recording): synthesised clicks after the master bus.
  private metronomeUntilBeat = -1;
  private metronomeLevel = 0.5;
  private clickRemain = 0;
  private clickLen = 1;
  private clickPhase = 0;
  private clickInc = 0;
  private clickAmp = 0;

  constructor(sampleRate = 48000, options: ArrangementEngineOptions = {}) {
    this.sampleRate = sampleRate;
    this.registry = options.registry ?? defaultRegistry;
    this.maxBlock = Math.max(128, options.maxBlockSize ?? DEFAULT_MAX_BLOCK);
    this.useLoop = options.useLoop === true;
    this.outputStage = options.outputStage ?? 'master';
    const maxPlayers = Math.max(1, Math.min(32, options.maxPlayers ?? 4));
    for (let i = 0; i < maxPlayers; i++) {
      const p = new TechnoEngine(sampleRate, this.registry, this.maxBlock, { dryOutput: true });
      p.setSampleBank((id) => this.assets(id));
      this.playerPool.push(p);
      this.freePlayers.push(p);
    }
    this.masterFx = new FxChain(sampleRate, this.registry);
    this.masterBus = new MasterBus(sampleRate);
    this.mixL = new Float32Array(this.maxBlock);
    this.mixR = new Float32Array(this.maxBlock);
    this.tmpL = new Float32Array(this.maxBlock);
    this.tmpR = new Float32Array(this.maxBlock);
    this.compiled = compileArrangement(EMPTY_DOC, new Map(), sampleRate);
    this.telemetry = {
      songBeat: 0,
      trackPeaks: new Float32Array(0),
      masterPeak: 0,
      activePlayers: 0,
      playerLimitHit: false,
    };
  }

  public getCompiled(): CompiledArrangement {
    return this.compiled;
  }

  public getTelemetry(): ArrangementTelemetry {
    return this.telemetry;
  }

  public getSampleRate(): number {
    return this.sampleRate;
  }

  public setAssetLookup(lookup: AudioAssetLookup): void {
    this.assets = lookup;
  }

  /** Re-compiles after the asset set changed (frozen clips may switch to audio). */
  public refreshAssets(): void {
    for (const p of this.playerPool) p.refreshSamples();
    if (this.doc) this.setArrangement(this.doc, this.sectionsRef);
  }

  /**
   * Loads / updates the arrangement while playing. Players of chains that still
   * exist (same first clip) keep running, so edits do not interrupt the music.
   */
  public setArrangement(doc: ArrangementDoc, sections: ReadonlyMap<string, BeatSnapshot>): void {
    const prev = this.compiled;
    const next = compileArrangement(doc, sections, this.sampleRate, (id) => !!this.assets(id));
    this.doc = doc;
    this.sectionsRef = sections;

    // Carry players over by chain key.
    const byKey = new Map<string, TechnoEngine>();
    for (let c = 0; c < prev.chainCount; c++) {
      const p = this.chainPlayer[c];
      if (p) byKey.set(prev.chainKeys[c]!, p);
    }
    this.chainPlayer = new Array<TechnoEngine | null>(next.chainCount).fill(null);
    this.chainSnapshot = new Array<BeatSnapshot | null>(next.chainCount).fill(null);
    this.chainStamp = new Int32Array(next.chainCount);
    for (let c = 0; c < next.chainCount; c++) {
      const p = byKey.get(next.chainKeys[c]!);
      if (p) {
        this.chainPlayer[c] = p;
        byKey.delete(next.chainKeys[c]!);
      }
    }
    for (const p of byKey.values()) this.freePlayers.push(p);

    // Track buses (kept by track id for FX tails).
    const buses: TrackBus[] = [];
    const seen = new Set<string>();
    for (const track of doc.tracks) {
      let bus = this.busCache.get(track.id);
      if (!bus) {
        bus = {
          id: track.id,
          fx: new FxChain(this.sampleRate, this.registry),
          bufL: new Float32Array(this.maxBlock),
          bufR: new Float32Array(this.maxBlock),
          gainL: new OnePoleSmoother(this.sampleRate, 12, 0),
          gainR: new OnePoleSmoother(this.sampleRate, 12, 0),
          levelEval: null,
          panEval: null,
          hasSignal: false,
          peak: 0,
        };
        this.busCache.set(track.id, bus);
      }
      bus.fx.sync(track.fx);
      bus.levelEval = null;
      bus.panEval = null;
      seen.add(track.id);
      buses.push(bus);
    }
    for (const id of [...this.busCache.keys()]) if (!seen.has(id)) this.busCache.delete(id);
    this.trackBuses = buses;
    this.masterFx.sync(doc.masterFx);
    this.masterGainEval = null;
    this.masterGlueEval = null;
    this.bindAutomation(doc);

    if (this.telemetry.trackPeaks.length !== buses.length) {
      this.telemetry.trackPeaks = new Float32Array(buses.length);
    }

    this.compiled = next;
    if (doc.loop && doc.loop.enabled && doc.loop.endBeat > doc.loop.startBeat) {
      this.loopStartSample = next.tempoMap.beatToSample(doc.loop.startBeat, this.sampleRate);
      this.loopEndSample = next.tempoMap.beatToSample(doc.loop.endBeat, this.sampleRate);
    } else {
      this.loopEndSample = -1;
    }
    this.eventCursor = this.findEventCursor(this.samplePos);
  }

  private bindAutomation(doc: ArrangementDoc): void {
    for (const lane of doc.automation) {
      if (!lane.enabled || lane.points.length === 0) continue;
      const t = lane.target;
      switch (t.scope) {
        case 'master':
          if (t.param === 'gain') this.masterGainEval = new LaneEvaluator(lane.points, 0, 2);
          else this.masterGlueEval = new LaneEvaluator(lane.points, 0, 1);
          break;
        case 'master-fx': {
          const r = this.masterFx.paramRange(t.cardId, t.paramId);
          if (r) this.masterFx.bind(t.cardId, t.paramId, new LaneEvaluator(lane.points, r.min, r.max));
          break;
        }
        case 'track': {
          const bus = this.busCache.get(t.trackId);
          if (!bus) break;
          if (t.param === 'level') bus.levelEval = new LaneEvaluator(lane.points, 0, 1.5);
          else bus.panEval = new LaneEvaluator(lane.points, -1, 1);
          break;
        }
        case 'track-fx': {
          const bus = this.busCache.get(t.trackId);
          const r = bus?.fx.paramRange(t.cardId, t.paramId);
          if (bus && r) bus.fx.bind(t.cardId, t.paramId, new LaneEvaluator(lane.points, r.min, r.max));
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Metronome clicks until `untilBeat` (Infinity = always, -1 = off).
   * Used for the count-in before a recording and optionally while recording.
   */
  public setMetronome(untilBeat: number, level = 0.5): void {
    this.metronomeUntilBeat = untilBeat;
    this.metronomeLevel = Math.max(0, Math.min(1, level));
  }

  private renderMetronome(outL: Float32Array, outR: Float32Array, offset: number, count: number, songBeat: number, beatsPerSample: number): void {
    const until = this.metronomeUntilBeat;
    if (until < 0 && this.clickRemain <= 0) return;
    const tm = this.compiled.tempoMap;
    // Beat k sounds at the first sample at/after it: idx = ceil((k - songBeat) / bps).
    // The smallest k belonging to this chunk is the first integer > songBeat - bps.
    const idxOf = (k: number) => Math.max(0, Math.ceil((k - songBeat) / beatsPerSample - 1e-9));
    let nextBeat = Math.floor(songBeat - beatsPerSample) + 1;
    let nextIdx = nextBeat < until ? idxOf(nextBeat) : Infinity;
    for (let i = 0; i < count; i++) {
      if (i === nextIdx) {
        const accent = tm.barPosition(nextBeat).beatInBar < 1e-6;
        this.clickLen = Math.round(0.03 * this.sampleRate);
        this.clickRemain = this.clickLen;
        this.clickInc = (2 * Math.PI * (accent ? 1760 : 1175)) / this.sampleRate;
        this.clickAmp = this.metronomeLevel * (accent ? 1 : 0.6);
        this.clickPhase = 0;
        nextBeat += 1;
        nextIdx = nextBeat < until ? idxOf(nextBeat) : Infinity;
      }
      if (this.clickRemain > 0) {
        const env = this.clickRemain / this.clickLen;
        const v = Math.sin(this.clickPhase) * this.clickAmp * env * env;
        this.clickPhase += this.clickInc;
        this.clickRemain--;
        outL[offset + i]! += v;
        outR[offset + i]! += v;
      }
    }
  }

  /** Jumps to a song beat; all clip players restart in sync there. */
  public seekToBeat(beat: number): void {
    const sample = Math.max(0, this.compiled.tempoMap.beatToSample(Math.max(0, beat), this.sampleRate));
    this.locate(sample, true);
  }

  public getSongBeat(): number {
    return this.compiled.tempoMap.sampleToBeat(this.samplePos, this.sampleRate);
  }

  public getSamplePosition(): number {
    return this.samplePos;
  }

  /** Full reset: position 0, all tails cleared. */
  public reset(): void {
    this.locate(0, true);
  }

  private locate(sample: number, clearTails: boolean): void {
    for (let c = 0; c < this.chainPlayer.length; c++) {
      const p = this.chainPlayer[c];
      if (p) {
        this.freePlayers.push(p);
        this.chainPlayer[c] = null;
        this.chainSnapshot[c] = null;
      }
    }
    if (clearTails) {
      for (const bus of this.trackBuses) {
        bus.fx.reset();
        bus.gainL.reset(0);
        bus.gainR.reset(0);
      }
      this.masterFx.reset();
      this.masterBus.reset();
    }
    this.samplePos = sample;
    this.eventCursor = this.findEventCursor(sample);
    this.telemetry.songBeat = this.getSongBeat();
  }

  private findEventCursor(sample: number): number {
    const ev = this.compiled.events;
    let lo = 0;
    let hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid]! <= sample) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  public processBlock(outL: Float32Array, outR: Float32Array, numSamples: number): void {
    const total = Math.min(numSamples | 0, outL.length, outR.length);
    let done = 0;
    while (done < total) {
      if (this.useLoop && this.loopEndSample > 0 && this.samplePos >= this.loopEndSample) {
        this.locate(this.loopStartSample, false);
      }
      const ev = this.compiled.events;
      while (this.eventCursor < ev.length && ev[this.eventCursor]! <= this.samplePos) this.eventCursor++;
      let chunk = Math.min(total - done, this.maxBlock);
      if (this.eventCursor < ev.length) {
        chunk = Math.min(chunk, ev[this.eventCursor]! - this.samplePos);
      }
      if (this.useLoop && this.loopEndSample > this.samplePos) {
        chunk = Math.min(chunk, this.loopEndSample - this.samplePos);
      }
      chunk = Math.max(1, chunk | 0);
      this.renderChunk(outL, outR, done, chunk);
      done += chunk;
      this.samplePos += chunk;
    }
    this.telemetry.songBeat = this.getSongBeat();
  }

  private acquirePlayer(): TechnoEngine | null {
    return this.freePlayers.pop() ?? null;
  }

  private renderChunk(outL: Float32Array, outR: Float32Array, outOffset: number, count: number): void {
    const comp = this.compiled;
    const sr = this.sampleRate;
    const pos = this.samplePos;
    const songBeat = comp.tempoMap.sampleToBeat(pos, sr);
    const bpm = comp.tempoMap.bpmAt(songBeat + 1e-9);
    const beatsPerSample = bpm / (60 * sr);
    const samplesPerBeat = 1 / beatsPerSample;
    const minEdgeBeats = MIN_EDGE_FADE_SEC * (bpm / 60);
    const stamp = ++this.stamp;
    const buses = this.trackBuses;

    for (let t = 0; t < buses.length; t++) {
      const bus = buses[t]!;
      bus.bufL.fill(0, 0, count);
      bus.bufR.fill(0, 0, count);
      bus.hasSignal = false;
    }

    let activePlayers = 0;
    const segs = comp.segments;
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s]!;
      if (pos < seg.startSample || pos >= seg.tailEndSample) continue;
      const inTail = pos >= seg.endSample;
      const bus = buses[seg.trackIndex];
      if (!bus) continue;

      if (seg.kind === 'section') {
        const chain = seg.chain;
        this.chainStamp[chain] = stamp;
        if (!seg.snapshot) continue;
        let player = this.chainPlayer[chain] ?? null;
        const localBeat = songBeat - seg.startBeat + seg.offsetBeats;
        if (!player) {
          player = this.acquirePlayer();
          if (!player) {
            this.telemetry.playerLimitHit = true;
            continue;
          }
          player.reset();
          player.applySnapshot(seg.snapshot);
          player.seekToBeat(localBeat);
          this.chainPlayer[chain] = player;
          this.chainSnapshot[chain] = seg.snapshot;
        } else if (this.chainSnapshot[chain] !== seg.snapshot) {
          player.applySnapshot(seg.snapshot);
          this.chainSnapshot[chain] = seg.snapshot;
        }
        player.setTempoBpm(bpm);
        const drift = (player.getBeatPosition() - localBeat) * samplesPerBeat;
        if (drift > 1 || drift < -1) player.seekToBeat(localBeat);
        player.setVoicesSilenced(inTail);
        const lanes = seg.layerLanes;
        if (lanes.length > 0) {
          for (let k = 0; k < lanes.length; k++) {
            const ll = lanes[k]!;
            const rel = songBeat - ll.clipStartBeat;
            const lv = ll.level ? ll.level.value(rel) : NaN;
            const pn = ll.pan ? ll.pan.value(rel) : NaN;
            const en = ll.enabled ? (ll.enabled.value(rel) >= 0.5 ? 1 : 0) : -1;
            player.setLayerOverride(ll.layerIndex, lv, pn, en);
          }
        } else if (player.getHasLayerOverrides()) {
          player.clearLayerOverrides();
        }
        const pl = seg.paramLanes;
        for (let k = 0; k < pl.length; k++) {
          const lane = pl[k]!;
          const v = lane.evaluator.value(songBeat - lane.clipStartBeat);
          player.setExternalValue(lane.slot, v === v ? (v - lane.base) / lane.span : 0);
        }
        activePlayers++;
        player.processBlock(this.tmpL, this.tmpR, count);
      } else {
        if (!this.readAudio(seg, songBeat, pos, count)) continue;
      }

      // Clip envelope (gain + fades) and accumulation into the track bus.
      const fadeIn = seg.hardStart ? Math.max(seg.fadeInBeats, minEdgeBeats) : seg.fadeInBeats;
      // With a tail the voices are gated instead (cards keep ringing): no fade-out edge.
      const hasTail = seg.tailEndSample > seg.endSample;
      const fadeOut = hasTail ? 0 : seg.hardEnd ? Math.max(seg.fadeOutBeats, minEdgeBeats) : seg.fadeOutBeats;
      const inClip = songBeat - seg.startBeat;
      const toEnd = seg.endBeat - songBeat;
      const chunkBeats = count * beatsPerSample;
      const bL = bus.bufL;
      const bR = bus.bufR;
      const tL = this.tmpL;
      const tR = this.tmpR;
      const g = seg.gain;
      if ((fadeIn <= 0 || inClip >= fadeIn) && (fadeOut <= 0 || toEnd - chunkBeats >= fadeOut)) {
        if (g === 1) {
          for (let i = 0; i < count; i++) {
            bL[i]! += tL[i]!;
            bR[i]! += tR[i]!;
          }
        } else {
          for (let i = 0; i < count; i++) {
            bL[i]! += tL[i]! * g;
            bR[i]! += tR[i]! * g;
          }
        }
      } else {
        const invIn = fadeIn > 0 ? 1 / fadeIn : 0;
        const invOut = fadeOut > 0 ? 1 / fadeOut : 0;
        for (let i = 0; i < count; i++) {
          const b = inClip + i * beatsPerSample;
          let e = g;
          if (fadeIn > 0 && b < fadeIn) e *= fadeGain(seg.fadeInShape, b * invIn);
          const r = toEnd - i * beatsPerSample;
          if (fadeOut > 0 && r < fadeOut) e *= fadeGain(seg.fadeOutShape, r * invOut);
          bL[i]! += tL[i]! * e;
          bR[i]! += tR[i]! * e;
        }
      }
      bus.hasSignal = true;
    }

    // Free players of chains that are not playing any more.
    for (let c = 0; c < this.chainPlayer.length; c++) {
      const p = this.chainPlayer[c];
      if (p && this.chainStamp[c] !== stamp) {
        this.freePlayers.push(p);
        this.chainPlayer[c] = null;
        this.chainSnapshot[c] = null;
      }
    }
    this.telemetry.activePlayers = activePlayers;

    // Tracks → master mix.
    const mixL = this.mixL;
    const mixR = this.mixR;
    mixL.fill(0, 0, count);
    mixR.fill(0, 0, count);
    if (this.outputStage === 'raw-clips') {
      for (let t = 0; t < buses.length; t++) {
        const bus = buses[t]!;
        if (!bus.hasSignal) continue;
        for (let i = 0; i < count; i++) {
          mixL[i]! += bus.bufL[i]!;
          mixR[i]! += bus.bufR[i]!;
        }
      }
      for (let i = 0; i < count; i++) {
        outL[outOffset + i] = mixL[i]!;
        outR[outOffset + i] = mixR[i]!;
      }
      return;
    }
    const tracks = comp.tracks;
    for (let t = 0; t < buses.length; t++) {
      const bus = buses[t]!;
      const tr = tracks[t];
      if (!tr) continue;
      const audible = !tr.muted && (!comp.anySolo || tr.solo);
      const bL = bus.bufL;
      const bR = bus.bufR;
      // FX run even without new input so tails ring out.
      if (!bus.fx.isEmpty) bus.fx.process(bL, bR, 0, count, bpm, songBeat, beatsPerSample);
      let peak = bus.peak;
      for (let o = 0; o < count; o += 32) {
        const len = Math.min(32, count - o);
        const beat = songBeat + o * beatsPerSample;
        let level = tr.level;
        let pan = tr.pan;
        if (bus.levelEval) {
          const v = bus.levelEval.value(beat);
          if (v === v) level = v;
        }
        if (bus.panEval) {
          const v = bus.panEval.value(beat);
          if (v === v) pan = v;
        }
        const lv = audible ? (level < 0 ? 0 : level > 1.5 ? 1.5 : level) : 0;
        const pn = pan < -1 ? -1 : pan > 1 ? 1 : pan;
        const ang = (pn + 1) * (Math.PI * 0.25);
        // Centre pan = unity on both sides (×√2 restores equal-power to 1).
        const tgL = lv * Math.cos(ang) * Math.SQRT2;
        const tgR = lv * Math.sin(ang) * Math.SQRT2;
        for (let i = o; i < o + len; i++) {
          const gl = bus.gainL.process(tgL);
          const gr = bus.gainR.process(tgR);
          const l = bL[i]! * gl;
          const r = bR[i]! * gr;
          mixL[i]! += l;
          mixR[i]! += r;
          const al = l < 0 ? -l : l;
          const ar = r < 0 ? -r : r;
          if (al > peak) peak = al;
          if (ar > peak) peak = ar;
        }
      }
      bus.peak = peak;
      this.telemetry.trackPeaks[t] = peak;
    }

    if (this.outputStage === 'pre-master') {
      for (let i = 0; i < count; i++) {
        outL[outOffset + i] = mixL[i]!;
        outR[outOffset + i] = mixR[i]!;
      }
      return;
    }

    // Master FX + bus (glue / limiter) with automation.
    if (!this.masterFx.isEmpty) this.masterFx.process(mixL, mixR, 0, count, bpm, songBeat, beatsPerSample);
    const doc = this.doc;
    let mg = doc ? doc.masterGain : 1;
    let glue = doc ? doc.masterGlue : 0.3;
    if (this.masterGainEval) {
      const v = this.masterGainEval.value(songBeat);
      if (v === v) mg = v;
    }
    if (this.masterGlueEval) {
      const v = this.masterGlueEval.value(songBeat);
      if (v === v) glue = v;
    }
    this.masterBus.processBlock(mixL, mixR, count, mg < 0 ? 0 : mg > 2 ? 2 : mg, glue < 0 ? 0 : glue > 1 ? 1 : glue);

    let mp = this.telemetry.masterPeak;
    for (let i = 0; i < count; i++) {
      const l = mixL[i]!;
      const r = mixR[i]!;
      const sl = l * 0 === 0 ? l : 0;
      const srr = r * 0 === 0 ? r : 0;
      outL[outOffset + i] = sl;
      outR[outOffset + i] = srr;
      const al = sl < 0 ? -sl : sl;
      const ar = srr < 0 ? -srr : srr;
      if (al > mp) mp = al;
      if (ar > mp) mp = ar;
    }
    this.telemetry.masterPeak = mp;
    this.renderMetronome(outL, outR, outOffset, count, songBeat, beatsPerSample);
  }

  /** Reads an audio clip chunk into tmpL/tmpR. Returns false when nothing to play. */
  private readAudio(seg: CompiledSegment, songBeat: number, pos: number, count: number): boolean {
    const asset = this.assets(seg.assetId);
    if (!asset || asset.length <= 0) return false;
    const tL = this.tmpL;
    const tR = this.tmpR;
    const ratio = asset.sampleRate / this.sampleRate;
    // Seconds since clip start (audio is not time-stretched by tempo changes).
    const secInClip = (pos - seg.startSample) / this.sampleRate;
    let src = (seg.sourceOffsetSec + secInClip) * asset.sampleRate;
    const len = asset.length;
    const L = asset.left;
    const R = asset.right;
    // Reversed: read the clip window backwards from its end.
    const clipLenSrc = (seg.endSample - seg.startSample) * ratio;
    const revBase = seg.sourceOffsetSec * asset.sampleRate + clipLenSrc - 1;
    void songBeat;
    for (let i = 0; i < count; i++) {
      const p = seg.reversed ? revBase - (src - seg.sourceOffsetSec * asset.sampleRate) : src;
      if (p < 0 || p >= len - 1) {
        tL[i] = 0;
        tR[i] = 0;
      } else {
        const i0 = p | 0;
        const f = p - i0;
        tL[i] = L[i0]! + (L[i0 + 1]! - L[i0]!) * f;
        tR[i] = R[i0]! + (R[i0 + 1]! - R[i0]!) * f;
      }
      src += ratio;
    }
    return true;
  }
}

export const EMPTY_DOC: ArrangementDoc = {
  version: 1,
  tempoMarkers: [{ id: 'tempo-0', beat: 0, bpm: 130 }],
  meterMarkers: [{ id: 'meter-0', beat: 0, numerator: 4, denominator: 4 }],
  songMarkers: [],
  tracks: [],
  masterFx: [],
  masterGain: 1,
  masterGlue: 0.3,
  automation: [],
  snap: { enabled: true, grid: 'bar' },
};

export type { SectionClip };
