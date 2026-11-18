import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Power, Spline, Trash2 } from 'lucide-react';
import { defaultRegistry } from '../../core/defaultRegistry';
import { buildDefaultParams } from '../../core/registry/types';
import type { ProcessorCardConfig } from '../../core/state/types';
import { formatParamValue, fromSliderPosition, toSliderPosition } from '../components/SchemaControl';
import { makeTimelineId } from './useArrangementStore';
import { LiveRange } from './controls';

interface FxChainEditorProps {
  cards: readonly ProcessorCardConfig[];
  accent: string;
  /** Structural change (one undo step). */
  onCommit: (cards: readonly ProcessorCardConfig[], label: string) => void;
  /** Slider preview. */
  onLive: (cards: readonly ProcessorCardConfig[]) => void;
  onLiveEnd: (label: string) => void;
  /** Keyframe lane for a card parameter. */
  hasLane: (cardId: string, paramId: string) => boolean;
  onAddLane: (cardId: string, paramId: string, label: string, value: number) => void;
}

export function createFxCard(moduleId: string): ProcessorCardConfig | null {
  const mod = defaultRegistry.getProcessor(moduleId);
  if (!mod) return null;
  return {
    id: makeTimelineId('fx'),
    moduleId,
    version: mod.version,
    bypassed: false,
    params: buildDefaultParams(mod),
  };
}

/** Effect chain of a timeline track or the master (same cards as in the Beatkasten). */
export function FxChainEditor({ cards, accent, onCommit, onLive, onLiveEnd, hasLane, onAddLane }: FxChainEditorProps) {
  const processors = defaultRegistry.listProcessors();
  const [addId, setAddId] = useState<string>(processors[0]?.id ?? '');

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    onCommit(next, 'Effekt verschoben');
  };

  return (
    <div className="tl-fx-chain">
      {cards.length === 0 && (
        <div className="muted-note">Noch keine Effekte. Karten wirken auf die ganze Spur (z. B. Hall auf Gesang).</div>
      )}
      {cards.map((card, idx) => {
        const mod = defaultRegistry.getProcessor(card.moduleId);
        if (!mod) return null;
        return (
          <div key={card.id} className={`sub-card${card.bypassed ? ' is-bypassed' : ''}`}>
            <div className="sub-card-head">
              <span className="sub-card-title" title={mod.description}>
                {mod.displayName}
              </span>
              <div style={{ display: 'flex', gap: 3 }}>
                <button type="button" className="btn-ghost btn-sm" disabled={idx === 0} onClick={() => move(idx, -1)} title="Nach oben">
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={idx === cards.length - 1}
                  onClick={() => move(idx, 1)}
                  title="Nach unten"
                >
                  <ArrowDown size={11} />
                </button>
                <button
                  type="button"
                  className={`btn-sm${!card.bypassed ? ' is-active' : ''}`}
                  onClick={() =>
                    onCommit(
                      cards.map((c) => (c.id === card.id ? { ...c, bypassed: !c.bypassed } : c)),
                      card.bypassed ? 'Effekt an' : 'Effekt umgangen',
                    )
                  }
                  title="Karte aktivieren / umgehen"
                >
                  <Power size={11} />
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-danger btn-sm"
                  onClick={() => onCommit(cards.filter((c) => c.id !== card.id), `Effekt entfernt: ${mod.displayName}`)}
                  title="Karte entfernen"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
            {mod.parameters.filter((p) => !p.hidden).map((schema) => {
              const value = card.params[schema.id] ?? schema.defaultValue;
              const automated = hasLane(card.id, schema.id);
              return (
                <div key={schema.id} className="schema-control" title={schema.description}>
                  <div className="schema-control-row">
                    <div className="schema-label-wrap">
                      <span className="schema-label">{schema.label}</span>
                      <button
                        type="button"
                        className={`tl-auto-btn${automated ? ' is-active' : ''}`}
                        onClick={() => onAddLane(card.id, schema.id, `${mod.displayName} · ${schema.label}`, value)}
                        title={automated ? 'Hat Keyframes (Automationsspur öffnen)' : 'Keyframes über die Zeit (Automationsspur anlegen)'}
                      >
                        <Spline size={10} />
                      </button>
                    </div>
                    <span className="schema-value">{formatParamValue(schema, value)}</span>
                  </div>
                  <LiveRange
                    min={0}
                    max={1}
                    step={0.001}
                    value={toSliderPosition(schema, value)}
                    accent={accent}
                    onLive={(pos) =>
                      onLive(
                        cards.map((c) =>
                          c.id === card.id ? { ...c, params: { ...c.params, [schema.id]: fromSliderPosition(schema, pos) } } : c,
                        ),
                      )
                    }
                    onCommit={() => onLiveEnd(`${mod.displayName}: ${schema.label}`)}
                    onDoubleClick={() =>
                      onCommit(
                        cards.map((c) =>
                          c.id === card.id ? { ...c, params: { ...c.params, [schema.id]: schema.defaultValue } } : c,
                        ),
                        `${schema.label} zurückgesetzt`,
                      )
                    }
                    title={automated ? 'Wird von Keyframes gesteuert (Grundwert)' : 'Doppelklick = Standardwert'}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
      <div className="sub-card">
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={addId} onChange={(e) => setAddId(e.target.value)} style={{ flex: 1 }}>
            {processors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              const card = createFxCard(addId);
              if (card) onCommit([...cards, card], `Effekt hinzugefügt: ${defaultRegistry.getProcessor(addId)?.displayName ?? addId}`);
            }}
          >
            <Plus size={12} /> Effekt
          </button>
        </div>
      </div>
    </div>
  );
}
