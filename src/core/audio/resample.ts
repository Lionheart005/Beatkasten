/**
 * Sample-rate conversion to the project rate (windowed-sinc, Blackman window).
 * Used on import so every asset in the pool runs at 48 kHz.
 */
const HALF_TAPS = 16;

export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0) || Math.round(fromRate) === Math.round(toRate)) return input.slice();
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  // Downsampling: lower the cutoff to avoid aliasing.
  const cutoff = Math.min(1, ratio) * 0.97;
  const n = input.length;
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const center = Math.floor(pos);
    let acc = 0;
    let norm = 0;
    for (let k = -HALF_TAPS + 1; k <= HALF_TAPS; k++) {
      const idx = center + k;
      if (idx < 0 || idx >= n) continue;
      const x = pos - idx;
      const sx = x * cutoff;
      const sinc = Math.abs(sx) < 1e-9 ? 1 : Math.sin(Math.PI * sx) / (Math.PI * sx);
      const wpos = (x + HALF_TAPS) / (2 * HALF_TAPS);
      const win = wpos <= 0 || wpos >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * wpos) + 0.08 * Math.cos(4 * Math.PI * wpos);
      const wgt = sinc * win;
      acc += input[idx]! * wgt;
      norm += wgt;
    }
    out[i] = norm > 1e-9 ? acc / norm : 0;
  }
  return out;
}
