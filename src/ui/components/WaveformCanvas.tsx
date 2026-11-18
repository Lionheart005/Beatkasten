import { memo, useEffect, useRef } from 'react';
import { pickPeakLevel, type WaveformPeaks } from '../../core/audio/peaks';

interface WaveformCanvasProps {
  peaks: WaveformPeaks;
  /** First source sample shown at x = 0. */
  startSample: number;
  /** Number of source samples across the width. */
  spanSamples: number;
  width: number;
  height: number;
  color?: string;
  reversed?: boolean;
  className?: string;
  /** Optional markers (source samples) drawn as vertical lines. */
  markers?: ReadonlyArray<{ sample: number; color: string }>;
}

const MAX_CANVAS = 8192;

function WaveformCanvasImpl({
  peaks,
  startSample,
  spanSamples,
  width,
  height,
  color = 'rgba(226,232,240,0.75)',
  reversed = false,
  className,
  markers,
}: WaveformCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = Math.max(1, Math.min(MAX_CANVAS, Math.round(width)));
    const h = Math.max(1, Math.round(height));
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const spp = spanSamples / w;
    const level = pickPeakLevel(peaks, Math.max(1, spp));
    const bucket = peaks.levels[level]!;
    const data = peaks.data[level]!;
    const buckets = data.length / 2;
    const mid = h / 2;
    ctx.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const xs = reversed ? w - 1 - x : x;
      const s0 = startSample + xs * spp;
      const s1 = s0 + Math.max(spp, 1);
      const b0 = Math.max(0, Math.floor(s0 / bucket));
      const b1 = Math.min(buckets - 1, Math.floor(s1 / bucket));
      if (b0 >= buckets || b1 < 0 || s0 >= peaks.length) continue;
      let mn = 0;
      let mx = 0;
      for (let b = b0; b <= b1; b++) {
        const lo = data[b * 2]!;
        const hi = data[b * 2 + 1]!;
        if (lo < mn) mn = lo;
        if (hi > mx) mx = hi;
      }
      const y0 = mid - mx * mid * 0.95;
      const y1 = mid - mn * mid * 0.95;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    if (markers) {
      for (const m of markers) {
        const x = ((m.sample - startSample) / spanSamples) * w;
        if (x < 0 || x > w) continue;
        ctx.fillStyle = m.color;
        ctx.fillRect(Math.round(x), 0, 2, h);
      }
    }
  }, [peaks, startSample, spanSamples, width, height, color, reversed, markers]);
  return <canvas ref={ref} className={className} style={{ width, height }} />;
}

export const WaveformCanvas = memo(WaveformCanvasImpl);
