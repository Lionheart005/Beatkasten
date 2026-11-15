import { useEffect, useRef, useState } from 'react';
import { defaultRegistry } from '../../core/defaultRegistry';
import type { TimeFrame } from '../../core/registry/types';
import type { LayerConfig } from '../../core/state/types';
import { cycleToBeats } from '../../core/theory/cycles';

type PreviewTimeFrame = TimeFrame & { readonly pulseSlope?: number };

interface TimePreviewCanvasProps {
  layer: LayerConfig;
  beatsPerBar: number;
  currentPhase?: number;
  height?: number;
  showHeader?: boolean;
  isPlaying?: boolean;
  peakLevel?: number;
}

function formatCycleReadout(cycleBeats: number, beatsPerBar: number): string {
  const safeBeatsPerBar = Math.max(1, beatsPerBar);
  const bars = cycleBeats / safeBeatsPerBar;
  if (cycleBeats >= safeBeatsPerBar && Math.abs(bars - Math.round(bars)) < 1e-6) {
    const wholeBars = Math.round(bars);
    return `${wholeBars} ${wholeBars === 1 ? 'Takt' : 'Takte'}`;
  }
  const formattedBeats = Number.isInteger(cycleBeats)
    ? String(cycleBeats)
    : cycleBeats.toFixed(1);
  return `${formattedBeats} Beats`;
}

export function TimePreviewCanvas({
  layer,
  beatsPerBar,
  currentPhase = 0,
  height = 84,
  showHeader = false,
  isPlaying = false,
  peakLevel = 0,
}: TimePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  const cycleBeats = cycleToBeats(
    layer.cycleLength.value,
    layer.cycleLength.unit,
    beatsPerBar,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextWidth = Math.round(entry.contentRect.width);
        setCanvasWidth((prev) => (prev !== nextWidth ? nextWidth : prev));
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvasWidth || 260;
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    const samples = 256;
    const energies = new Float32Array(samples);
    const triggers = new Float32Array(samples);

    let prevFrame: PreviewTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: -1,
      pulseSlope: 0,
    };

    for (let i = 0; i < samples; i++) {
      const p = i / samples;
      let frame: PreviewTimeFrame = {
        warpedPhase: p,
        pulseEnergy: prevFrame.pulseEnergy,
        triggerIntensity: 0,
        accent: 0,
        stepIndex: prevFrame.stepIndex,
        pulseSlope: prevFrame.pulseSlope ?? 0,
      };
      for (const opCfg of layer.timeOperators) {
        if (opCfg.bypassed) continue;
        const mod = defaultRegistry.getTimeOperator(opCfg.moduleId);
        if (!mod) continue;
        frame = mod.evaluateTime(
          {
            beatPosition: p * cycleBeats,
            barPosition: (p * cycleBeats) / Math.max(1, beatsPerBar),
            layerPhase: p,
            cycleIndex: 0,
            cycleBeats,
            beatsPerBar,
            sampleRate: 48000,
          },
          opCfg.params,
          frame,
        );
      }
      energies[i] = frame.pulseEnergy;
      triggers[i] = frame.triggerIntensity;
      prevFrame = frame;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Beat grid lines
    const gridCount = Math.max(1, Math.min(16, Math.round(cycleBeats)));
    ctx.strokeStyle = 'rgba(161, 174, 198, 0.14)';
    ctx.lineWidth = 1;
    for (let g = 1; g < gridCount; g++) {
      const gx = (g / gridCount) * width;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }

    // Filled pulse energy curve
    ctx.beginPath();
    ctx.moveTo(0, height - 4);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * width;
      const y = height - 4 - (energies[i] ?? 0) * (height - 12);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height - 4);
    ctx.closePath();
    ctx.fillStyle = `${layer.color}2e`;
    ctx.fill();

    // Stroke curve
    ctx.beginPath();
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * width;
      const y = height - 4 - (energies[i] ?? 0) * (height - 12);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Trigger spikes
    ctx.strokeStyle = '#eef2f9';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < samples; i++) {
      const t = triggers[i] ?? 0;
      if (t > 0.05) {
        const x = Math.max(1, Math.min(width - 1, (i / (samples - 1)) * width));
        const yTop = height - 4 - t * (height - 10);
        ctx.beginPath();
        ctx.moveTo(x, height - 4);
        ctx.lineTo(x, yTop);
        ctx.stroke();
      }
    }

    // Live playhead cursor
    const px = Math.max(0, Math.min(1, currentPhase)) * width;
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    ctx.restore();
  }, [
    beatsPerBar,
    canvasWidth,
    currentPhase,
    cycleBeats,
    height,
    layer.color,
    layer.timeOperators,
  ]);

  const canvasElement = (
    <canvas
      ref={canvasRef}
      className="canvas-box"
      style={{ height }}
      title="Rhythmus-Vorschau über einen vollen Layer-Zyklus"
    />
  );

  if (!showHeader) {
    return canvasElement;
  }

  return (
    <div className="scope-wrap">
      <div className="scope-header">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: layer.color,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontWeight: 600,
              color: '#eef2f9',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Wellenfunktion · {layer.name}
          </span>
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            · {formatCycleReadout(cycleBeats, beatsPerBar)}
          </span>
        </span>
        <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {isPlaying
            ? `Pegel ${(peakLevel * 100).toFixed(0)} % · Playhead aktiv`
            : 'Bereit — Play drücken'}
        </span>
      </div>
      {canvasElement}
    </div>
  );
}
