/**
 * Audio analysis for the pool and the sample instrument: peak, silence
 * trimming, root-note detection (YIN) and transient slicing.
 */

export function peakOf(channels: readonly Float32Array[], start = 0, end = Infinity): number {
  let p = 0;
  for (const c of channels) {
    const e = Math.min(c.length, end);
    for (let i = Math.max(0, start); i < e; i++) {
      const a = Math.abs(c[i]!);
      if (a > p) p = a;
    }
  }
  return p;
}

/** Start / end sample of the non-silent part (threshold in dBFS). */
export function findSilenceBounds(
  channels: readonly Float32Array[],
  thresholdDb = -48,
  padSamples = 240,
): { start: number; end: number } {
  const len = Math.min(...channels.map((c) => c.length));
  const thr = Math.pow(10, thresholdDb / 20);
  let start = 0;
  let end = len;
  outer: for (let i = 0; i < len; i++) for (const c of channels) if (Math.abs(c[i]!) > thr) { start = i; break outer; }
  outer2: for (let i = len - 1; i >= start; i--) for (const c of channels) if (Math.abs(c[i]!) > thr) { end = i + 1; break outer2; }
  return { start: Math.max(0, start - padSamples), end: Math.min(len, end + padSamples) };
}

/**
 * YIN fundamental frequency estimate over a window (mono). Returns Hz or null.
 */
export function detectPitchYin(
  signal: Float32Array,
  sampleRate: number,
  minHz = 40,
  maxHz = 1600,
  threshold = 0.12,
): number | null {
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(signal.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxTau <= minTau + 2) return null;
  const W = Math.min(signal.length - maxTau, 4096);
  if (W < 256) return null;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const diff = signal[i]! - signal[i + tau]!;
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau]!;
    cmnd[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
  }
  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau]! < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1]! < cmnd[tau]!) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst < 0) {
    // Fall back to the global minimum if it is reasonably clear.
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau]! < cmnd[best]!) best = tau;
    if (cmnd[best]! > 0.35) return null;
    tauEst = best;
  }
  // Parabolic interpolation.
  const x0 = tauEst > 1 ? cmnd[tauEst - 1]! : cmnd[tauEst]!;
  const x2 = tauEst < maxTau ? cmnd[tauEst + 1]! : cmnd[tauEst]!;
  const x1 = cmnd[tauEst]!;
  const denom = x0 + x2 - 2 * x1;
  const shift = Math.abs(denom) > 1e-12 ? (x0 - x2) / (2 * denom) : 0;
  return sampleRate / (tauEst + shift);
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Root note (MIDI, rounded) of a sample: YIN on the loudest part. */
export function detectRootMidi(channels: readonly Float32Array[], sampleRate: number): number | null {
  const len = Math.min(...channels.map((c) => c.length));
  if (len < 2048) return null;
  const mono = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < len; i++) mono[i]! += c[i]! / channels.length;
  // Analyse a window after the attack (skip the first 10 % / max 50 ms).
  const startAt = Math.min(Math.floor(len * 0.1), Math.floor(sampleRate * 0.05));
  const win = mono.subarray(startAt, Math.min(len, startAt + Math.floor(sampleRate * 0.25)));
  const hz = detectPitchYin(win, sampleRate);
  if (!hz || !Number.isFinite(hz)) return null;
  return Math.round(hzToMidi(hz));
}

/** Onset positions (samples) via spectral-flux-like energy rises. */
export function detectTransients(
  channels: readonly Float32Array[],
  sampleRate: number,
  sensitivity = 0.5,
  maxSlices = 32,
): number[] {
  const len = Math.min(...channels.map((c) => c.length));
  const hop = Math.max(64, Math.round(sampleRate * 0.005));
  const frames = Math.floor(len / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (const c of channels) for (let i = f * hop; i < (f + 1) * hop; i++) e += c[i]! * c[i]!;
    env[f] = Math.sqrt(e / (hop * channels.length));
  }
  const out: number[] = [0];
  const minGap = Math.round((0.06 * sampleRate) / hop);
  const ratio = 1.6 + (1 - sensitivity) * 3;
  let last = -minGap;
  for (let f = 2; f < frames; f++) {
    const prev = (env[f - 1]! + env[f - 2]!) / 2 + 1e-4;
    if (env[f]! > prev * ratio && env[f]! > 0.02 && f - last >= minGap) {
      out.push(f * hop);
      last = f;
      if (out.length >= maxSlices) break;
    }
  }
  return out;
}
