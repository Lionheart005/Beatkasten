/** Min/max peaks for waveform drawing (several zoom levels). */
export interface WaveformPeaks {
  /** Samples per peak of each level (ascending). */
  readonly levels: readonly number[];
  /** Interleaved min,max per bucket (mono sum of all channels) per level. */
  readonly data: readonly Float32Array[];
  readonly length: number;
}

export const PEAK_LEVELS = [64, 512, 4096] as const;

export function computePeaks(channels: readonly Float32Array[], levels: readonly number[] = PEAK_LEVELS): WaveformPeaks {
  const length = Math.min(...channels.map((c) => c.length));
  const data = levels.map((spp) => {
    const buckets = Math.ceil(length / spp);
    const out = new Float32Array(buckets * 2);
    for (let b = 0; b < buckets; b++) {
      let mn = 0;
      let mx = 0;
      const end = Math.min(length, (b + 1) * spp);
      for (let i = b * spp; i < end; i++) {
        let s = 0;
        for (const c of channels) s += c[i]!;
        s /= channels.length;
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
      out[b * 2] = mn;
      out[b * 2 + 1] = mx;
    }
    return out;
  });
  return { levels, data, length };
}

/** Chooses the coarsest level that still has ≥ 1 bucket per pixel. */
export function pickPeakLevel(peaks: WaveformPeaks, samplesPerPixel: number): number {
  let best = 0;
  for (let i = 0; i < peaks.levels.length; i++) if (peaks.levels[i]! <= samplesPerPixel) best = i;
  return best;
}
