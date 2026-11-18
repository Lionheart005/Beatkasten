/**
 * Derives the snapshot a section clip actually plays: the section's snapshot
 * with song tempo, transposition and per-clip layer overrides applied.
 * Pure. The snapshot id stays the section's id, so consecutive clips of the
 * same section never trigger a structural crossfade in the engine.
 */
import type { BeatSnapshot, LayerConfig } from '../state/types';
import type { LayerOverride, SectionClip } from './types';

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export function applyLayerOverride(layer: LayerConfig, ov: LayerOverride | undefined): LayerConfig {
  if (!ov) return layer;
  let next = layer;
  if (ov.enabled === false) {
    // Muting (not disabling) keeps the layer's fade-out and its pulse for sidechains.
    next = { ...next, muted: true };
  } else if (ov.enabled === true) {
    next = { ...next, enabled: true, muted: false };
  }
  if (ov.level !== undefined && Number.isFinite(ov.level)) {
    next = { ...next, level: clamp(ov.level, 0, 1.5) };
  }
  if (ov.pan !== undefined && Number.isFinite(ov.pan)) {
    next = { ...next, pan: clamp(ov.pan, -1, 1) };
  }
  return next;
}

export function deriveClipSnapshot(
  section: BeatSnapshot,
  clip: Pick<SectionClip, 'layerOverrides' | 'transposeSemitones'>,
  songBpm: number,
): BeatSnapshot {
  const transpose = Math.round(clamp(clip.transposeSemitones ?? 0, -12, 12));
  const overrides = clip.layerOverrides ?? {};
  const hasOverrides = Object.keys(overrides).length > 0;
  return {
    ...section,
    tempoBpm: songBpm,
    harmony:
      transpose === 0
        ? section.harmony
        : { ...section.harmony, rootNote: section.harmony.rootNote + transpose },
    layers: hasOverrides
      ? section.layers.map((l) => applyLayerOverride(l, overrides[l.id]))
      : section.layers,
  };
}

/** Stable identity key of a derived snapshot (seamless-merge detection). */
export function clipSoundKey(
  clip: Pick<SectionClip, 'sectionId' | 'layerOverrides' | 'transposeSemitones' | 'gain'>,
): string {
  return JSON.stringify([
    clip.sectionId,
    clip.transposeSemitones ?? 0,
    clip.gain,
    Object.keys(clip.layerOverrides ?? {})
      .sort()
      .map((k) => [k, clip.layerOverrides[k]]),
  ]);
}

/** FNV-1a 32-bit hash (hex) of a string. */
export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Freeze cache key of a section clip: everything that changes its sound
 * (section snapshot, overrides, transposition, offset, length, tempo map,
 * clip-layer keyframes). Gain and fades are applied live and not part of it.
 */
export function clipFreezeKey(
  clip: SectionClip,
  section: BeatSnapshot,
  tempoJson: string,
  clipLanesJson: string,
): string {
  return hashString(
    JSON.stringify([
      section,
      clip.layerOverrides,
      clip.transposeSemitones ?? 0,
      clip.sourceOffsetBeats,
      clip.lengthBeats,
      clip.startBeat,
      tempoJson,
      clipLanesJson,
    ]),
  );
}

export function freezeKeyForDoc(
  doc: { readonly tempoMarkers: unknown; readonly automation: ReadonlyArray<{ readonly target: { readonly scope: string; readonly clipId?: string } }> },
  clip: SectionClip,
  section: BeatSnapshot,
): string {
  const lanes = doc.automation.filter(
    (l) => (l.target.scope === 'clip-layer' || l.target.scope === 'clip-layer-param') && l.target.clipId === clip.id,
  );
  return clipFreezeKey(clip, section, JSON.stringify(doc.tempoMarkers), JSON.stringify(lanes));
}
