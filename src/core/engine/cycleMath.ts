import type { BeatSnapshot } from '../state/types';
import { computeCombinedCycleBeats, cycleToBeats } from '../theory/cycles';
import { buildHarmonyTimeline } from '../theory/progression';

/**
 * Length (in beats) after which the complete constellation of all enabled
 * layers, their movements and the chord progression repeats (LCM).
 */
export function computeSnapshotCycleBeats(
  snapshot: BeatSnapshot,
  beatsPerBar: number,
  harmonyTotalBeats = 0,
): number {
  let combined = 4;
  let hasEnabled = false;

  for (let i = 0; i < snapshot.layers.length; i++) {
    const layer = snapshot.layers[i]!;
    if (!layer.enabled) continue;

    const layerBeats = cycleToBeats(
      layer.cycleLength.value,
      layer.cycleLength.unit,
      beatsPerBar,
    );
    combined = hasEnabled
      ? computeCombinedCycleBeats(combined, layerBeats)
      : layerBeats;
    hasEnabled = true;

    for (let m = 0; m < layer.modulations.length; m++) {
      const mod = layer.modulations[m]!;
      if (!mod.enabled) continue;

      if (mod.sourceType === 'wave-lfo' || mod.sourceType === 'macro-arc') {
        const defaultVal = mod.sourceType === 'macro-arc' ? 8 : 4;
        const defaultUnit = mod.sourceType === 'macro-arc' ? 'bars' : 'beats';
        const modBeats = cycleToBeats(
          mod.sourceConfig.cycleValue ?? defaultVal,
          mod.sourceConfig.cycleUnit ?? defaultUnit,
          beatsPerBar,
        );
        combined = computeCombinedCycleBeats(combined, modBeats);
      } else if (mod.sourceType === 'drawn-curve') {
        let cv: number | undefined;
        let cu: typeof mod.sourceConfig.cycleUnit;
        for (let c = 0; c < snapshot.curves.length; c++) {
          const curve = snapshot.curves[c]!;
          if (curve.id === mod.sourceConfig.curveId) {
            cv = curve.cycleValue;
            cu = curve.cycleUnit;
            break;
          }
        }
        cv = cv ?? mod.sourceConfig.cycleValue;
        cu = cu ?? mod.sourceConfig.cycleUnit;
        if (cv !== undefined && cu !== undefined) {
          combined = computeCombinedCycleBeats(
            combined,
            cycleToBeats(cv, cu, beatsPerBar),
          );
        }
      }
    }
  }

  // The chord progression is part of the full repetition cycle.
  if (harmonyTotalBeats > 0) {
    combined = computeCombinedCycleBeats(combined, harmonyTotalBeats);
  }

  return combined;
}

/** Beats per bar for a snapshot's time signature (7/8 -> 3.5 quarter beats). */
export function snapshotBeatsPerBar(snapshot: BeatSnapshot): number {
  const num = snapshot.timeSignature.numerator || 4;
  const den = snapshot.timeSignature.denominator || 4;
  return Math.min(16, Math.max(1, num * (4 / den)));
}

/** Full repetition length in bars (rounded up), incl. the chord progression. */
export function computeFullRepeatBars(snapshot: BeatSnapshot): number {
  const bpb = snapshotBeatsPerBar(snapshot);
  const timeline = buildHarmonyTimeline(snapshot.harmony, bpb);
  const beats = computeSnapshotCycleBeats(
    snapshot,
    bpb,
    timeline.steps.length > 1 ? timeline.totalBeats : 0,
  );
  return Math.max(1, Math.ceil(beats / bpb - 1e-6));
}
