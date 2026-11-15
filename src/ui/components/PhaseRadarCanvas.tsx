import { useEffect, useMemo, useRef } from 'react';
import type { LiveTelemetry } from '../../audio-host';
import type { LayerConfig } from '../../core/state/types';
import { computeCombinedCycleBeats, cycleToBeats } from '../../core/theory/cycles';

interface PhaseRadarCanvasProps {
  layers: readonly LayerConfig[];
  beatsPerBar: number;
  selectedLayerId: string;
  telemetry: LiveTelemetry;
  isPlaying: boolean;
  onSelectLayer: (layerId: string) => void;
}

export function PhaseRadarCanvas({
  layers,
  beatsPerBar,
  selectedLayerId,
  telemetry,
  isPlaying,
  onSelectLayer,
}: PhaseRadarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const combinedBeats = useMemo(() => {
    const activeLayers = layers.filter((l) => l.enabled && !l.muted);
    const pool = activeLayers.length > 0 ? activeLayers : layers;
    let combined = 4;
    let first = true;
    for (const layer of pool) {
      const layerBeats = cycleToBeats(
        layer.cycleLength.value,
        layer.cycleLength.unit,
        beatsPerBar,
      );
      if (first) {
        combined = layerBeats;
        first = false;
      } else {
        combined = computeCombinedCycleBeats(combined, layerBeats);
      }
      for (const mod of layer.modulations) {
        if (
          mod.enabled &&
          mod.sourceConfig.cycleValue &&
          mod.sourceConfig.cycleUnit
        ) {
          const modBeats = cycleToBeats(
            mod.sourceConfig.cycleValue,
            mod.sourceConfig.cycleUnit,
            beatsPerBar,
          );
          combined = computeCombinedCycleBeats(combined, modBeats);
        }
      }
    }
    return combined;
  }, [beatsPerBar, layers]);

  const combinedBars = combinedBeats / Math.max(1, beatsPerBar);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 112;
    if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const maxR = size / 2 - 8;
    const minR = 14;

    // Radar crosshair & subtle beat grid
    ctx.strokeStyle = 'rgba(161, 174, 198, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 6);
    ctx.lineTo(cx, size - 6);
    ctx.moveTo(6, cy);
    ctx.lineTo(size - 6, cy);
    ctx.stroke();

    const count = Math.max(1, layers.length);
    const stepR = count > 1 ? (maxR - minR) / (count - 1) : 0;

    layers.forEach((layer, idx) => {
      const r = count === 1 ? maxR * 0.72 : minR + idx * stepR;
      const phase = telemetry.layerPhases[idx] ?? 0;
      const energy = telemetry.layerEnergies[idx] ?? 0;
      const isSelected = layer.id === selectedLayerId;
      const isMuted = layer.muted || !layer.enabled;

      // Base ring
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = layer.color;
      ctx.globalAlpha = isMuted ? 0.18 : isSelected ? 0.85 : 0.45;
      ctx.lineWidth = isSelected ? 2.5 : 1.6;
      ctx.stroke();

      // Active pulse glow arc
      if (!isMuted && energy > 0.04) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = layer.color;
        ctx.globalAlpha = Math.min(0.85, energy * 0.75);
        ctx.lineWidth = 2 + energy * 4.5;
        ctx.stroke();
      }

      // Phase marker dot on ring
      const angle = phase * Math.PI * 2 - Math.PI / 2;
      const dotX = cx + Math.cos(angle) * r;
      const dotY = cy + Math.sin(angle) * r;

      ctx.globalAlpha = isMuted ? 0.3 : 1;
      ctx.beginPath();
      ctx.arc(dotX, dotY, isSelected ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = layer.color;
      ctx.fill();

      if (!isMuted && isPlaying && energy > 0.18) {
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4 + energy * 5, 0, Math.PI * 2);
        ctx.strokeStyle = layer.color;
        ctx.globalAlpha = 0.45 * energy;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    // Center hub showing beat pulse
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = isPlaying ? '#38bdf8' : '#6c7993';
    ctx.fill();

    ctx.restore();
  }, [isPlaying, layers, selectedLayerId, telemetry]);

  return (
    <div className="visual-card">
      <canvas
        ref={canvasRef}
        style={{ width: 112, height: 112, flexShrink: 0 }}
        title="Phasen-Radar: Zeigt die aktuellen Umlauf-Phasen aller Layer"
      />
      <div className="radar-meta">
        <div className="radar-title">
          Phasen-Radar · Takt {Math.floor(telemetry.currentBar) + 1} · Beat{' '}
          {((telemetry.currentBeat % beatsPerBar) + 1).toFixed(1)}
        </div>
        <div className="radar-riddle-box">
          Wiederholungs-Rätsel schließt alle{' '}
          <strong>
            {Number.isInteger(combinedBeats)
              ? combinedBeats
              : combinedBeats.toFixed(1)}{' '}
            Beats
          </strong>{' '}
          ({Number.isInteger(combinedBars) ? combinedBars : combinedBars.toFixed(1)}{' '}
          Takte)
        </div>
        <div className="radar-legend">
          {layers.map((layer) => {
            const unitLabel = layer.cycleLength.unit === 'bars' ? 'T' : 'B';
            return (
              <button
                key={layer.id}
                type="button"
                className={`radar-legend-pill${
                  layer.muted || !layer.enabled ? ' is-muted' : ''
                }`}
                style={{
                  borderColor:
                    layer.id === selectedLayerId ? layer.color : undefined,
                }}
                onClick={() => onSelectLayer(layer.id)}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: layer.color,
                    display: 'inline-block',
                  }}
                />
                <span>{layer.name}</span>
                <span style={{ opacity: 0.7 }}>
                  ({layer.cycleLength.value}
                  {unitLabel})
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
