import { clamp } from '../dsp/smoothing';
import {
  type DrawnCurveData,
  evaluateDrawnCurve,
  evaluateWaveBipolar,
  evaluateWaveUnipolar,
  wrapPhase01,
} from '../math';
import { type ParameterSchema } from '../registry/types';
import {
  type BeatSnapshot,
  type LayerConfig,
  type ModulationRouteConfig,
  type ModulationTargetDomain,
} from '../state/types';
import { cycleToBeats } from '../theory/cycles';

export const CURVE_LUT_SIZE = 512;
const CURVE_LUT_MASK = CURVE_LUT_SIZE - 1;

function clampParamLocal(schema: ParameterSchema, value: number): number {
  const safe = Number.isFinite(value) ? value : schema.defaultValue;
  const clamped = safe < schema.min ? schema.min : safe > schema.max ? schema.max : safe;
  if (schema.step !== undefined && schema.step > 0) {
    const stepped = Math.round((clamped - schema.min) / schema.step) * schema.step + schema.min;
    return stepped < schema.min ? schema.min : stepped > schema.max ? schema.max : stepped;
  }
  return clamped;
}

interface BakedCurveEntry {
  readonly lut: Float32Array;
  curve: DrawnCurveData;
}

interface LayerRouteCache {
  capacity: number;
  routeCount: number;
  lastRoutesRef: readonly ModulationRouteConfig[] | null;
  enabledMask: number;
  hasEnabledRoutes: boolean;
  effectiveDepth: Float64Array;
  effectiveRateMul: Float64Array;
  signal: Float64Array;
  depthAdd: Float64Array;
  depthMul: Float64Array;
  rateAdd: Float64Array;
  rateMul: Float64Array;
  modTargetIndex: Int32Array;
  pass1Indices: number[];
  pass2Indices: number[];
  voiceBuckets: Map<string, number[]>;
  timeBuckets: Map<string, number[]>;
  procBuckets: Map<string, number[]>;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function createLayerRouteCache(capacity: number): LayerRouteCache {
  const cap = Math.max(8, capacity);
  return {
    capacity: cap,
    routeCount: 0,
    lastRoutesRef: null,
    enabledMask: 0,
    hasEnabledRoutes: false,
    effectiveDepth: new Float64Array(cap),
    effectiveRateMul: new Float64Array(cap),
    signal: new Float64Array(cap),
    depthAdd: new Float64Array(cap),
    depthMul: new Float64Array(cap),
    rateAdd: new Float64Array(cap),
    rateMul: new Float64Array(cap),
    modTargetIndex: new Int32Array(cap),
    pass1Indices: [],
    pass2Indices: [],
    voiceBuckets: new Map(),
    timeBuckets: new Map(),
    procBuckets: new Map(),
  };
}

function clearBuckets(map: Map<string, number[]>): void {
  for (const arr of map.values()) {
    arr.length = 0;
  }
}

function pushBucket(map: Map<string, number[]>, key: string, idx: number): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(idx);
}

function computeEnabledMask(routes: readonly ModulationRouteConfig[]): number {
  const limit = routes.length < 30 ? routes.length : 30;
  let mask = 0;
  for (let i = 0; i < limit; i++) {
    if (routes[i]!.enabled) mask |= 1 << i;
  }
  return mask;
}

function resizeLayerRouteCache(cache: LayerRouteCache, needed: number): void {
  if (needed <= cache.capacity) return;
  const newCap = Math.max(needed, cache.capacity * 2);
  cache.capacity = newCap;
  cache.effectiveDepth = new Float64Array(newCap);
  cache.effectiveRateMul = new Float64Array(newCap);
  cache.signal = new Float64Array(newCap);
  cache.depthAdd = new Float64Array(newCap);
  cache.depthMul = new Float64Array(newCap);
  cache.rateAdd = new Float64Array(newCap);
  cache.rateMul = new Float64Array(newCap);
  cache.modTargetIndex = new Int32Array(newCap);
}

/**
 * Evaluates all modulation routes (wave LFOs, layer-to-layer pulse followers,
 * pre-baked 512-point drawn curves, macro arcs, and 1-pass wave-on-wave
 * modulation) with guaranteed parameter bounds and zero heap allocations
 * during audio rendering.
 */
export class ModulationRouter {
  private readonly curveLuts = new Map<string, BakedCurveEntry>();
  private readonly layerCaches = new Map<string, LayerRouteCache>();

  /**
   * Pre-bakes all drawn curves into 512-point Float32Array lookup tables and
   * prepares per-layer modulation caches ahead of audio rendering.
   */
  /** Timeline keyframe values for 'external' routes (signal in parameter spans). */
  private readonly externalValues = new Float64Array(64);

  public setExternalValue(slot: number, value: number): void {
    if (slot >= 0 && slot < this.externalValues.length) this.externalValues[slot] = value;
  }

  public prepareSnapshot(snapshot: BeatSnapshot): void {
    this.prepareCurves(snapshot.curves);

    // Prune caches for removed layers, then prepare active layers.
    for (const existingLayerId of this.layerCaches.keys()) {
      let stillPresent = false;
      for (let i = 0; i < snapshot.layers.length; i++) {
        if (snapshot.layers[i]!.id === existingLayerId) {
          stillPresent = true;
          break;
        }
      }
      if (!stillPresent) {
        this.layerCaches.delete(existingLayerId);
      }
    }

    for (let i = 0; i < snapshot.layers.length; i++) {
      this.prepareLayer(snapshot.layers[i]!);
    }
  }

  /**
   * Bakes `DrawnCurveData` points into reusable 512-point Float32Array LUTs.
   */
  public prepareCurves(curves: readonly DrawnCurveData[]): void {
    for (const existingId of this.curveLuts.keys()) {
      let stillPresent = false;
      for (let i = 0; i < curves.length; i++) {
        if (curves[i]!.id === existingId) {
          stillPresent = true;
          break;
        }
      }
      if (!stillPresent) {
        this.curveLuts.delete(existingId);
      }
    }

    for (let c = 0; c < curves.length; c++) {
      const curve = curves[c]!;
      let entry = this.curveLuts.get(curve.id);
      if (!entry) {
        entry = {
          lut: new Float32Array(CURVE_LUT_SIZE),
          curve,
        };
        this.curveLuts.set(curve.id, entry);
      } else {
        entry.curve = curve;
      }

      const lut = entry.lut;
      for (let i = 0; i < CURVE_LUT_SIZE; i++) {
        lut[i] = evaluateDrawnCurve(curve.points, i / CURVE_LUT_SIZE);
      }
    }
  }

  /**
   * Ensures pre-allocated route scratch buffers and target-route index links
   * exist for a layer.
   */
  public prepareLayer(layer: LayerConfig): LayerRouteCache {
    let cache = this.layerCaches.get(layer.id);
    const routes = layer.modulations;
    if (!cache) {
      cache = createLayerRouteCache(routes.length);
      this.layerCaches.set(layer.id, cache);
    } else {
      resizeLayerRouteCache(cache, routes.length);
    }

    cache.routeCount = routes.length;
    cache.lastRoutesRef = routes;
    cache.enabledMask = computeEnabledMask(routes);
    cache.pass1Indices.length = 0;
    cache.pass2Indices.length = 0;
    clearBuckets(cache.voiceBuckets);
    clearBuckets(cache.timeBuckets);
    clearBuckets(cache.procBuckets);

    let anyEnabled = false;
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]!;
      let targetIdx = -1;
      if (route.targetDomain === 'modulation') {
        for (let j = 0; j < routes.length; j++) {
          if (i !== j && routes[j]!.id === route.targetCardId) {
            // Only target non-modulation routes in 1-pass evaluation to guarantee zero cycles.
            if (routes[j]!.targetDomain !== 'modulation') {
              targetIdx = j;
            }
            break;
          }
        }
      }
      cache.modTargetIndex[i] = targetIdx;

      if (!route.enabled) continue;
      anyEnabled = true;

      if (route.targetDomain === 'modulation') {
        if (targetIdx >= 0) {
          cache.pass1Indices.push(i);
        }
      } else {
        cache.pass2Indices.push(i);
        if (route.targetDomain === 'voice') {
          pushBucket(cache.voiceBuckets, route.targetCardId, i);
        } else if (route.targetDomain === 'time') {
          pushBucket(cache.timeBuckets, route.targetCardId, i);
        } else {
          pushBucket(cache.procBuckets, route.targetCardId, i);
        }
      }
    }
    cache.hasEnabledRoutes = anyEnabled;

    return cache;
  }

  private getValidCache(layer: LayerConfig): LayerRouteCache {
    const routes = layer.modulations;
    const count = routes.length;
    let cache = this.layerCaches.get(layer.id);
    if (
      !cache ||
      cache.capacity < count ||
      cache.routeCount !== count ||
      cache.lastRoutesRef !== routes ||
      (count <= 30 && cache.enabledMask !== computeEnabledMask(routes))
    ) {
      cache = this.prepareLayer(layer);
    }
    return cache;
  }

  /**
   * Returns true if at least one enabled route targets the given domain and card ID.
   */
  public hasTargetRoutes(
    layer: LayerConfig,
    targetDomain: Exclude<ModulationTargetDomain, 'modulation'>,
    targetCardId: string,
    alternateTargetCardId?: string,
  ): boolean {
    if (layer.modulations.length === 0) return false;
    const cache = this.getValidCache(layer);
    if (!cache.hasEnabledRoutes) return false;
    const map =
      targetDomain === 'voice'
        ? cache.voiceBuckets
        : targetDomain === 'time'
          ? cache.timeBuckets
          : cache.procBuckets;
    const primary = map.get(targetCardId);
    if (primary !== undefined && primary.length > 0) return true;
    if (alternateTargetCardId !== undefined) {
      const alt = map.get(alternateTargetCardId);
      if (alt !== undefined && alt.length > 0) return true;
    }
    return false;
  }

  /**
   * Evaluates a pre-baked 512-point curve LUT via linear interpolation.
   */
  public sampleCurveLut(curveId: string, phase01: number): number | undefined {
    const entry = this.curveLuts.get(curveId);
    if (!entry) return undefined;
    return this.interpolateLut(entry.lut, phase01);
  }

  /**
   * Runs 1-pass modulation evaluation for a single layer at the current sub-block
   * position:
   * Pass 1: Evaluates `targetDomain === 'modulation'` routes (modulating target
   *         route `depth` or `rateMultiplier`, strictly acyclic).
   * Pass 2a: Evaluates source signals for all remaining active routes using
   *          their modulated `effectiveDepth` and `effectiveRateMultiplier`.
   */
  public beginLayerSubBlock(
    layer: LayerConfig,
    beatPosition: number,
    beatsPerBar: number,
    layerPulses: ReadonlyMap<string, number>,
  ): void {
    const routes = layer.modulations;
    const count = routes.length;
    if (count === 0) return;

    const cache = this.getValidCache(layer);
    if (!cache.hasEnabledRoutes) return;

    const {
      effectiveDepth,
      effectiveRateMul,
      signal,
      depthAdd,
      depthMul,
      rateAdd,
      rateMul,
      modTargetIndex,
      pass1Indices,
      pass2Indices,
    } = cache;

    if (pass1Indices.length === 0) {
      // Fast path: no wave-on-wave modulation routes active.
      for (let p = 0; p < pass2Indices.length; p++) {
        const i = pass2Indices[p]!;
        const route = routes[i]!;
        const effDepth = clamp(route.depth, -1, 1);
        effectiveDepth[i] = effDepth;
        effectiveRateMul[i] = 1;
        signal[i] = this.evaluateRouteSource(
          route,
          layer.id,
          beatPosition,
          beatsPerBar,
          1,
          layerPulses,
        );
      }
      return;
    }

    for (let p = 0; p < pass2Indices.length; p++) {
      const i = pass2Indices[p]!;
      depthAdd[i] = 0;
      depthMul[i] = 1;
      rateAdd[i] = 0;
      rateMul[i] = 1;
    }

    // Pass 1: Wave-on-wave modulation (`targetDomain === 'modulation'`).
    for (let p = 0; p < pass1Indices.length; p++) {
      const i = pass1Indices[p]!;
      const route = routes[i]!;
      const targetIdx = modTargetIndex[i]!;
      if (targetIdx < 0 || targetIdx >= count) continue;

      const modDepth = clamp(route.depth, -1, 1);
      const rawSig = this.evaluateRouteSource(
        route,
        layer.id,
        beatPosition,
        beatsPerBar,
        1,
        layerPulses,
      );

      if (route.targetParamId === 'depth') {
        if (route.combineMode === 'add') {
          depthAdd[targetIdx] += modDepth * rawSig;
        } else {
          const factor = 1 + modDepth * (rawSig - 1);
          depthMul[targetIdx] *= factor > 0 ? factor : 0;
        }
      } else if (route.targetParamId === 'rateMultiplier') {
        if (route.combineMode === 'add') {
          rateAdd[targetIdx] += modDepth * rawSig;
        } else {
          const factor = 1 + modDepth * (rawSig - 1);
          rateMul[targetIdx] *= factor > 0 ? factor : 0;
        }
      }
    }

    // Pass 2a: Resolve effective depth, rateMultiplier, and source signal for target routes.
    for (let p = 0; p < pass2Indices.length; p++) {
      const i = pass2Indices[p]!;
      const route = routes[i]!;

      const baseDepth = clamp(route.depth, -1, 1);
      const effDepth = clamp((baseDepth + depthAdd[i]!) * depthMul[i]!, -1, 1);
      const effRate = clamp((1 + rateAdd[i]!) * rateMul[i]!, 0.1, 8);

      effectiveDepth[i] = effDepth;
      effectiveRateMul[i] = effRate;
      signal[i] = this.evaluateRouteSource(
        route,
        layer.id,
        beatPosition,
        beatsPerBar,
        effRate,
        layerPulses,
      );
    }
  }

  /**
   * Computes modulated effective parameters into `outParams` (in-place, zero allocation)
   * with guaranteed `[schema.min, schema.max]` clamping.
   */
  public applyTargetModulation(
    layer: LayerConfig,
    targetDomain: Exclude<ModulationTargetDomain, 'modulation'>,
    targetCardId: string,
    alternateTargetCardId: string | undefined,
    schemas: readonly ParameterSchema[],
    baseParams: Record<string, number>,
    outParams: Record<string, number>,
  ): void {
    const routes = layer.modulations;
    const count = routes.length;
    const cache = count > 0 ? this.getValidCache(layer) : undefined;

    let bucket1: number[] | undefined;
    let bucket2: number[] | undefined;
    if (cache && cache.hasEnabledRoutes) {
      const map =
        targetDomain === 'voice'
          ? cache.voiceBuckets
          : targetDomain === 'time'
            ? cache.timeBuckets
            : cache.procBuckets;
      bucket1 = map.get(targetCardId);
      if (alternateTargetCardId !== undefined) {
        bucket2 = map.get(alternateTargetCardId);
      }
    }
    const len1 = bucket1 ? bucket1.length : 0;
    const len2 = bucket2 ? bucket2.length : 0;

    if (len1 === 0 && len2 === 0) {
      for (let s = 0; s < schemas.length; s++) {
        const schema = schemas[s]!;
        const rawBase = baseParams[schema.id];
        outParams[schema.id] = clampParamLocal(
          schema,
          rawBase === undefined ? schema.defaultValue : rawBase,
        );
      }
      return;
    }

    const effDepthArr = cache!.effectiveDepth;
    const signalArr = cache!.signal;

    for (let s = 0; s < schemas.length; s++) {
      const schema = schemas[s]!;
      const rawBase = baseParams[schema.id];
      const baseValue = clampParamLocal(
        schema,
        rawBase === undefined ? schema.defaultValue : rawBase,
      );

      if (!schema.modulatable) {
        outParams[schema.id] = baseValue;
        continue;
      }

      let sumAdd = 0;
      let mulFactor = 1;
      const span = schema.max - schema.min;

      for (let k = 0; k < len1; k++) {
        const idx = bucket1![k]!;
        const route = routes[idx]!;
        if (route.targetParamId !== schema.id) continue;
        const effDepth = effDepthArr[idx]!;
        const sig = signalArr[idx]!;
        if (route.combineMode === 'add') {
          sumAdd += effDepth * sig * span;
        } else {
          const factor = 1 + effDepth * (sig - 1);
          mulFactor *= factor > 0 ? factor : 0;
        }
      }

      for (let k = 0; k < len2; k++) {
        const idx = bucket2![k]!;
        const route = routes[idx]!;
        if (route.targetParamId !== schema.id) continue;
        const effDepth = effDepthArr[idx]!;
        const sig = signalArr[idx]!;
        if (route.combineMode === 'add') {
          sumAdd += effDepth * sig * span;
        } else {
          const factor = 1 + effDepth * (sig - 1);
          mulFactor *= factor > 0 ? factor : 0;
        }
      }

      outParams[schema.id] = clampParamLocal(schema, (baseValue + sumAdd) * mulFactor);
    }
  }

  private evaluateRouteSource(
    route: ModulationRouteConfig,
    ownLayerId: string,
    beatPosition: number,
    beatsPerBar: number,
    rateMultiplier: number,
    layerPulses: ReadonlyMap<string, number>,
  ): number {
    const cfg = route.sourceConfig;
    const isMultiply = route.combineMode === 'multiply';

    switch (route.sourceType) {
      case 'wave-lfo': {
        const waveform = cfg.waveform ?? 'sine';
        const cycleVal = cfg.cycleValue ?? 4;
        const cycleUnit = cfg.cycleUnit ?? 'beats';
        const phaseOffset = Number.isFinite(cfg.phaseOffset) ? cfg.phaseOffset! : 0;
        const cycleBeats = cycleToBeats(cycleVal, cycleUnit, beatsPerBar);
        const phase = wrapPhase01(
          (beatPosition / cycleBeats) * rateMultiplier + phaseOffset,
        );
        return isMultiply
          ? evaluateWaveUnipolar(waveform, phase)
          : evaluateWaveBipolar(waveform, phase);
      }

      case 'macro-arc': {
        const waveform = cfg.waveform ?? 'sine';
        const cycleVal = cfg.cycleValue ?? 8;
        const cycleUnit = cfg.cycleUnit ?? 'bars';
        const phaseOffset = Number.isFinite(cfg.phaseOffset) ? cfg.phaseOffset! : 0;
        const cycleBeats = cycleToBeats(cycleVal, cycleUnit, beatsPerBar);
        const phase = wrapPhase01(
          (beatPosition / cycleBeats) * rateMultiplier + phaseOffset,
        );
        return isMultiply
          ? evaluateWaveUnipolar(waveform, phase)
          : evaluateWaveBipolar(waveform, phase);
      }

      case 'layer-pulse': {
        const sourceId = cfg.sourceLayerId || ownLayerId;
        const pulse = clamp01(layerPulses.get(sourceId) ?? 0);
        return isMultiply ? pulse : pulse * 2 - 1;
      }

      case 'external': {
        const v = this.externalValues[cfg.externalSlot ?? 0];
        return v !== undefined && v === v ? v : isMultiply ? 1 : 0;
      }

      case 'drawn-curve': {
        const curveId = cfg.curveId;
        const entry = curveId ? this.curveLuts.get(curveId) : undefined;
        if (!entry) {
          return isMultiply ? 1 : 0;
        }
        const cycleVal = entry.curve.cycleValue ?? cfg.cycleValue ?? 4;
        const cycleUnit = entry.curve.cycleUnit ?? cfg.cycleUnit ?? 'beats';
        const phaseOffset = Number.isFinite(cfg.phaseOffset) ? cfg.phaseOffset! : 0;
        const cycleBeats = cycleToBeats(cycleVal, cycleUnit, beatsPerBar);
        const phase = wrapPhase01(
          (beatPosition / cycleBeats) * rateMultiplier + phaseOffset,
        );
        const val = this.interpolateLut(entry.lut, phase);
        return isMultiply ? val : (val - 0.5) * 2;
      }
    }
  }

  private interpolateLut(lut: Float32Array, phase01: number): number {
    const p = wrapPhase01(phase01);
    const scaled = p * CURVE_LUT_SIZE;
    const floorIdx = Math.floor(scaled);
    const idx0 = floorIdx & CURVE_LUT_MASK;
    const idx1 = (idx0 + 1) & CURVE_LUT_MASK;
    const frac = scaled - floorIdx;
    const v0 = lut[idx0] ?? 0;
    const v1 = lut[idx1] ?? 0;
    return clamp01(v0 + (v1 - v0) * frac);
  }
}
