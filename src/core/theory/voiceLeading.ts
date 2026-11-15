/**
 * Voice leading solver: picks one voicing (inversion × register × close/drop-2)
 * per chord so that voices move by the smallest possible steps, common tones
 * stay put, the top voice moves smoothly and the register does not drift.
 * The progression is treated as a loop (last chord -> first chord included).
 *
 * Runs only when the harmony settings change (never per audio block).
 */

export interface VoiceLeadingChord {
  /** Pitch class of the chord root (0..11). */
  readonly rootPc: number;
  /** Intervals in semitones relative to the root (may exceed 12). */
  readonly intervals: readonly number[];
}

export interface VoicingRange {
  readonly minMidi: number;
  readonly maxMidi: number;
}

export const DEFAULT_VOICING_RANGE: VoicingRange = { minMidi: 52, maxMidi: 77 };
export const MAX_CHORD_VOICES = 6;

const pcOf = (m: number): number => ((m % 12) + 12) % 12;

/** Reduces very large chords to at most MAX_CHORD_VOICES notes (drops 5th, then 11th). */
export function reduceChordIntervals(intervals: readonly number[]): number[] {
  const out = [...intervals];
  const dropOrder = [7, 17, 14];
  for (const drop of dropOrder) {
    if (out.length <= MAX_CHORD_VOICES) break;
    const idx = out.indexOf(drop);
    if (idx > 0) out.splice(idx, 1);
  }
  return out.slice(0, MAX_CHORD_VOICES);
}

function stackClose(seq: readonly number[], bottom: number): number[] {
  const notes: number[] = [bottom];
  let prev = bottom;
  for (let i = 1; i < seq.length; i++) {
    let n = prev + 1;
    while (pcOf(n) !== seq[i]) n++;
    notes.push(n);
    prev = n;
  }
  return notes;
}

/** All candidate voicings of a chord inside the range (each ascending). */
export function generateVoicings(
  chord: VoiceLeadingChord,
  range: VoicingRange = DEFAULT_VOICING_RANGE,
): number[][] {
  const intervals = reduceChordIntervals(chord.intervals);
  const pcs = intervals.map((i) => pcOf(chord.rootPc + i));
  const seen = new Set<string>();
  const out: number[][] = [];
  const push = (v: number[]) => {
    const key = v.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  for (let r = 0; r < pcs.length; r++) {
    const seq = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let start = range.minMidi - 2; start < range.minMidi + 22; start++) {
      if (pcOf(start) !== seq[0]) continue;
      const close = stackClose(seq, start);
      const top = close[close.length - 1]!;
      if (top <= range.maxMidi) push(close);
      if (close.length >= 4) {
        const drop2 = [...close];
        drop2[drop2.length - 2]! -= 12;
        drop2.sort((a, b) => a - b);
        if (drop2[0]! >= range.minMidi - 7 && drop2[drop2.length - 1]! <= range.maxMidi) {
          push(drop2);
        }
      }
    }
  }

  if (out.length === 0) {
    // Fallback: plain root position around the lower range edge.
    let bottom = range.minMidi;
    while (pcOf(bottom) !== pcOf(chord.rootPc)) bottom++;
    out.push(stackClose(pcs, bottom));
  }
  return out;
}

function nearest(x: number, set: readonly number[]): number {
  let best = Infinity;
  for (let i = 0; i < set.length; i++) {
    const d = Math.abs(x - set[i]!);
    if (d < best) best = d;
  }
  return best;
}

function mean(v: readonly number[]): number {
  let sum = 0;
  for (const x of v) sum += x;
  return v.length > 0 ? sum / v.length : 0;
}

function registerCost(v: readonly number[], center: number): number {
  return Math.abs(mean(v) - center) * 0.12;
}

/** Cost of moving from voicing `a` to voicing `b`. */
export function voicingMoveCost(
  a: readonly number[],
  b: readonly number[],
  center: number,
): number {
  let c = 0;
  for (const x of a) c += nearest(x, b);
  for (const y of b) {
    const d = nearest(y, a);
    c += d;
    if (d > 4) c += (d - 4) * (d - 4) * 0.35;
  }
  c *= 0.5;
  c += Math.abs(a[a.length - 1]! - b[b.length - 1]!) * 0.4;
  c += registerCost(b, center);
  return c;
}

/**
 * Solves voice leading for a looping chord progression. Returns one ascending
 * voicing per chord.
 */
export function solveVoiceLeading(
  chords: readonly VoiceLeadingChord[],
  range: VoicingRange = DEFAULT_VOICING_RANGE,
): number[][] {
  const k = chords.length;
  if (k === 0) return [];
  const center = (range.minMidi + range.maxMidi) / 2;
  let cands = chords.map((c) => generateVoicings(c, range));
  if (k > 16) {
    // Long chains: keep the 12 voicings closest to the register centre per chord.
    cands = cands.map((list) =>
      list.length <= 12
        ? list
        : [...list]
            .sort((a, b) => registerCost(a, center) - registerCost(b, center))
            .slice(0, 12),
    );
  }

  const firstCost = (v: readonly number[], rootPc: number) =>
    registerCost(v, center) * 4 + (pcOf(v[0]!) === pcOf(rootPc) ? 0 : 0.6);

  if (k === 1) {
    const c0 = cands[0]!;
    let best = c0[0]!;
    let bestCost = Infinity;
    for (const v of c0) {
      const cost = firstCost(v, chords[0]!.rootPc);
      if (cost < bestCost) {
        bestCost = cost;
        best = v;
      }
    }
    return [best];
  }

  // Limit start candidates for long progressions to keep the solve cheap
  // (the solve runs on the audio thread whenever the harmony changes).
  let startIdx = cands[0]!.map((_, i) => i);
  const maxStarts = k <= 12 ? Infinity : k <= 32 ? 4 : k <= 64 ? 2 : 1;
  if (startIdx.length > maxStarts) {
    startIdx = startIdx
      .sort(
        (i, j) =>
          firstCost(cands[0]![i]!, chords[0]!.rootPc) -
          firstCost(cands[0]![j]!, chords[0]!.rootPc),
      )
      .slice(0, maxStarts);
  }

  let bestTotal = Infinity;
  let bestPath: number[] = [];

  for (const s0 of startIdx) {
    // dp[i] = best cost to reach candidate i of the current step
    let prevCost = new Float64Array(cands[0]!.length).fill(Infinity);
    prevCost[s0] = firstCost(cands[0]![s0]!, chords[0]!.rootPc);
    const back: Int32Array[] = [new Int32Array(cands[0]!.length).fill(-1)];

    for (let step = 1; step < k; step++) {
      const cur = cands[step]!;
      const prev = cands[step - 1]!;
      const curCost = new Float64Array(cur.length).fill(Infinity);
      const curBack = new Int32Array(cur.length).fill(-1);
      for (let j = 0; j < cur.length; j++) {
        for (let i = 0; i < prev.length; i++) {
          const pc = prevCost[i]!;
          if (pc === Infinity) continue;
          const c = pc + voicingMoveCost(prev[i]!, cur[j]!, center);
          if (c < curCost[j]!) {
            curCost[j] = c;
            curBack[j] = i;
          }
        }
      }
      prevCost = curCost;
      back.push(curBack);
    }

    // Close the loop back to the fixed start voicing.
    const last = cands[k - 1]!;
    for (let j = 0; j < last.length; j++) {
      if (prevCost[j] === Infinity) continue;
      const total = prevCost[j]! + voicingMoveCost(last[j]!, cands[0]![s0]!, center);
      if (total < bestTotal) {
        bestTotal = total;
        const path = new Array<number>(k);
        path[k - 1] = j;
        for (let step = k - 1; step > 0; step--) {
          path[step - 1] = back[step]![path[step]!]!;
        }
        path[0] = s0;
        bestPath = path;
      }
    }
  }

  return bestPath.map((ci, step) => cands[step]![ci]!);
}
