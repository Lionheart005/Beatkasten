import { defaultRegistry } from '../../core/defaultRegistry';
import type { ArrangementDoc, AutomationTarget } from '../../core/arrangement/types';
import type { SectionItem } from '../../core/state/types';

export interface AutomationMeta {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly color: string;
  /** Song beat of lane beat 0. */
  readonly beatOffset: number;
  readonly valid: boolean;
}

export function automationMeta(
  doc: ArrangementDoc,
  target: AutomationTarget,
  sections: readonly SectionItem[],
): AutomationMeta {
  switch (target.scope) {
    case 'master':
      return target.param === 'gain'
        ? { label: 'Master · Lautstärke', min: 0, max: 2, color: '#38bdf8', beatOffset: 0, valid: true }
        : { label: 'Master · Glue', min: 0, max: 1, color: '#38bdf8', beatOffset: 0, valid: true };
    case 'master-fx': {
      const card = doc.masterFx.find((c) => c.id === target.cardId);
      const mod = card ? defaultRegistry.getProcessor(card.moduleId) : undefined;
      const p = mod?.parameters.find((x) => x.id === target.paramId);
      return {
        label: `Master · ${mod?.displayName ?? '?'} · ${p?.label ?? target.paramId}`,
        min: p?.min ?? 0,
        max: p?.max ?? 1,
        color: '#38bdf8',
        beatOffset: 0,
        valid: !!p,
      };
    }
    case 'track': {
      const t = doc.tracks.find((x) => x.id === target.trackId);
      return target.param === 'level'
        ? { label: `${t?.name ?? '?'} · Pegel`, min: 0, max: 1.5, color: t?.color ?? '#a855f7', beatOffset: 0, valid: !!t }
        : { label: `${t?.name ?? '?'} · Pan`, min: -1, max: 1, color: t?.color ?? '#a855f7', beatOffset: 0, valid: !!t };
    }
    case 'track-fx': {
      const t = doc.tracks.find((x) => x.id === target.trackId);
      const card = t?.fx.find((c) => c.id === target.cardId);
      const mod = card ? defaultRegistry.getProcessor(card.moduleId) : undefined;
      const p = mod?.parameters.find((x) => x.id === target.paramId);
      return {
        label: `${t?.name ?? '?'} · ${mod?.displayName ?? '?'} · ${p?.label ?? target.paramId}`,
        min: p?.min ?? 0,
        max: p?.max ?? 1,
        color: t?.color ?? '#a855f7',
        beatOffset: 0,
        valid: !!p,
      };
    }
    case 'clip-layer': {
      let clipStart = 0;
      let sectionId: string | null = null;
      let color = '#a855f7';
      for (const t of doc.tracks) {
        const c = t.clips.find((x) => x.id === target.clipId);
        if (c) {
          clipStart = c.startBeat;
          sectionId = c.kind === 'section' ? c.sectionId : null;
          color = t.color;
        }
      }
      const layer = sections.find((s) => s.id === sectionId)?.snapshot.layers.find((l) => l.id === target.layerId);
      const name = layer?.name ?? 'Layer';
      if (layer) color = layer.color;
      const base = { beatOffset: clipStart, color, valid: !!layer };
      if (target.param === 'pan') return { ...base, label: `${name} · Pan (Clip)`, min: -1, max: 1 };
      if (target.param === 'enabled') return { ...base, label: `${name} · An/Aus (Clip)`, min: 0, max: 1 };
      return { ...base, label: `${name} · Pegel (Clip)`, min: 0, max: 1.5 };
    }
    case 'clip-layer-param': {
      let clipStart = 0;
      let sectionId: string | null = null;
      for (const t of doc.tracks) {
        const c = t.clips.find((x) => x.id === target.clipId);
        if (c) {
          clipStart = c.startBeat;
          sectionId = c.kind === 'section' ? c.sectionId : null;
        }
      }
      const layer = sections.find((s) => s.id === sectionId)?.snapshot.layers.find((l) => l.id === target.layerId);
      const schema = layer ? layerParamSchema(layer, target.domain, target.cardId, target.paramId) : null;
      return {
        label: `${layer?.name ?? 'Layer'} · ${schema?.owner ?? ''} ${schema?.schema.label ?? target.paramId} (Clip)`,
        min: schema?.schema.min ?? 0,
        max: schema?.schema.max ?? 1,
        color: layer?.color ?? '#a855f7',
        beatOffset: clipStart,
        valid: !!schema,
      };
    }
  }
}

/** Track a lane is shown under (null = master area). */
export function laneTrackId(doc: ArrangementDoc, target: AutomationTarget): string | null {
  if (target.scope === 'track' || target.scope === 'track-fx') return target.trackId;
  if (target.scope === 'clip-layer') {
    for (const t of doc.tracks) if (t.clips.some((c) => c.id === target.clipId)) return t.id;
  }
  return null;
}

/** Schema of a modulatable control of a layer (voice or processor card). */
export function layerParamSchema(
  layer: SectionItem['snapshot']['layers'][number],
  domain: 'voice' | 'processor',
  cardId: string,
  paramId: string,
) {
  if (domain === 'voice') {
    const mod = defaultRegistry.getVoice(layer.voice.moduleId);
    const p = mod?.parameters.find((x) => x.id === paramId);
    return p ? { schema: p, owner: '', base: layer.voice.params[paramId] ?? p.defaultValue } : null;
  }
  const card = layer.processorChain.find((c) => c.id === cardId);
  const mod = card ? defaultRegistry.getProcessor(card.moduleId) : undefined;
  const p = mod?.parameters.find((x) => x.id === paramId);
  return p && card ? { schema: p, owner: `${mod!.displayName} ·`, base: card.params[paramId] ?? p.defaultValue } : null;
}

