import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveTelemetry } from '../../audio-host';
import { defaultRegistry } from '../../core/defaultRegistry';
import type { TimeFrame } from '../../core/registry/types';
import type { LayerConfig } from '../../core/state/types';
import { cycleToBeats } from '../../core/theory/cycles';

type PreviewTimeFrame = TimeFrame & { readonly pulseSlope?: number };

interface TimePreviewCanvasProps {
  layer: LayerConfig;
  beatsPerBar: number;
  layerIndex?: number;
  height?: number;
  showHeader?: boolean;
  isPlaying?: boolean;
  subscribeTelemetry?: (cb: (t: LiveTelemetry) => void) => () => void;
  getTelemetry?: () => LiveTelemetry;
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
  layerIndex = 0,
  height = 84,
  showHeader = false,
  isPlaying = false,
  subscribeTelemetry,
  getTelemetry,
}: TimePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusTextRef = useRef<HTMLSpanElement | null>(null);
  const telemetryRef = useRef<LiveTelemetry | null>(
    getTelemetry ? getTelemetry() : null,
  );
  const rafIdRef = useRef<number | null>(null);
  const logicalSizeRef = useRef<{ width: number; height: number; dpr: number }>(
    { width: 260, height, dpr: 1 },
  );
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

  const drawForeground = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height: logicalHeight, dpr } = logicalSizeRef.current;
    const telemetry = telemetryRef.current;
    const rawPhase = telemetry ? (telemetry.layerPhases[layerIndex] ?? 0) : 0;
    const clampedPhase = Math.max(0, Math.min(1, rawPhase));
    const px = clampedPhase * width;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bgCanvas = bgCanvasRef.current;
    if (bgCanvas && bgCanvas.width > 0 && bgCanvas.height > 0) {
      ctx.drawImage(bgCanvas, 0, 0, canvas.width, canvas.height);
    }

    ctx.scale(dpr, dpr);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, logicalHeight);
    ctx.stroke();
    ctx.restore();

    const statusEl = statusTextRef.current;
    if (statusEl) {
      if (isPlaying) {
        const peakPct = ((telemetry?.peakLevel ?? 0) * 100).toFixed(0);
        statusEl.textContent = `Pegel ${peakPct} % · Playhead aktiv`;
      } else {
        statusEl.textContent = 'Bereit — Play drücken';
      }
    }
  }, [isPlaying, layerIndex]);

  // Rebuild offscreen static waveform cache ONLY when curve/grid/size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvasWidth || 260;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    if (!bgCanvasRef.current) {
      bgCanvasRef.current = document.createElement('canvas');
    }
    const bgCanvas = bgCanvasRef.current;
    if (bgCanvas.width !== pixelWidth || bgCanvas.height !== pixelHeight) {
      bgCanvas.width = pixelWidth;
      bgCanvas.height = pixelHeight;
    }

    logicalSizeRef.current = { width, height, dpr };

    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) return;

    const samples = 512;
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

    // Per-operator scratch memory, mirroring LayerEngine slot state.
    const opStates = layer.timeOperators.map(() => new Float64Array(4).fill(Number.NaN));

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
      let hasPulseGenerator = false;
      for (let opIdx = 0; opIdx < layer.timeOperators.length; opIdx++) {
        const opCfg = layer.timeOperators[opIdx]!;
        if (opCfg.bypassed) continue;
        const mod = defaultRegistry.getTimeOperator(opCfg.moduleId);
        if (!mod) continue;
        const hadPulseSource = hasPulseGenerator;
        if (
          opCfg.moduleId === 'time-pulse-interference' ||
          opCfg.moduleId === 'time-euclid'
        ) {
          hasPulseGenerator = true;
        }
        frame = mod.evaluateTime(
          {
            beatPosition: p * cycleBeats,
            barPosition: (p * cycleBeats) / Math.max(1, beatsPerBar),
            layerPhase: p,
            cycleIndex: 0,
            cycleBeats,
            beatsPerBar,
            sampleRate: 48000,
            slotState: opStates[opIdx],
            hasPulseSource: hadPulseSource,
          },
          opCfg.params,
          frame,
        );
      }
      if (!hasPulseGenerator) {
        frame = {
          ...frame,
          pulseEnergy: 1,
          triggerIntensity: 0,
          accent: 1,
        };
      }
      energies[i] = frame.pulseEnergy;
      triggers[i] = frame.triggerIntensity;
      prevFrame = frame;
    }

    bgCtx.save();
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, pixelWidth, pixelHeight);
    bgCtx.scale(dpr, dpr);

    // Beat grid lines
    const gridCount = Math.max(1, Math.min(32, Math.round(cycleBeats)));
    bgCtx.strokeStyle = 'rgba(161, 174, 198, 0.14)';
    bgCtx.lineWidth = 1;
    for (let g = 1; g < gridCount; g++) {
      const gx = (g / gridCount) * width;
      bgCtx.beginPath();
      bgCtx.moveTo(gx, 0);
      bgCtx.lineTo(gx, height);
      bgCtx.stroke();
    }

    // Filled pulse energy curve
    bgCtx.beginPath();
    bgCtx.moveTo(0, height - 4);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * width;
      const y = height - 4 - (energies[i] ?? 0) * (height - 12);
      bgCtx.lineTo(x, y);
    }
    bgCtx.lineTo(width, height - 4);
    bgCtx.closePath();
    bgCtx.fillStyle = `${layer.color}2e`;
    bgCtx.fill();

    // Stroke curve
    bgCtx.beginPath();
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * width;
      const y = height - 4 - (energies[i] ?? 0) * (height - 12);
      if (i === 0) bgCtx.moveTo(x, y);
      else bgCtx.lineTo(x, y);
    }
    bgCtx.strokeStyle = layer.color;
    bgCtx.lineWidth = 1.8;
    bgCtx.stroke();

    // Trigger spikes
    bgCtx.strokeStyle = '#eef2f9';
    bgCtx.lineWidth = 1.4;
    for (let i = 0; i < samples; i++) {
      const t = triggers[i] ?? 0;
      if (t > 0.05) {
        const x = Math.max(1, Math.min(width - 1, (i / (samples - 1)) * width));
        const yTop = height - 4 - t * (height - 10);
        bgCtx.beginPath();
        bgCtx.moveTo(x, height - 4);
        bgCtx.lineTo(x, yTop);
        bgCtx.stroke();
      }
    }

    bgCtx.restore();

    telemetryRef.current = getTelemetry ? getTelemetry() : telemetryRef.current;
    drawForeground();
  }, [
    beatsPerBar,
    canvasWidth,
    cycleBeats,
    drawForeground,
    getTelemetry,
    height,
    layer.color,
    layer.cycleLength,
    layer.timeOperators,
  ]);

  // Subscribe to live telemetry for rAF-throttled playhead & status text updates
  useEffect(() => {
    telemetryRef.current = getTelemetry ? getTelemetry() : null;
    drawForeground();

    if (!subscribeTelemetry) return;

    const unsubscribe = subscribeTelemetry((nextTelemetry) => {
      telemetryRef.current = nextTelemetry;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        drawForeground();
      });
    });

    return () => {
      unsubscribe();
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [drawForeground, getTelemetry, subscribeTelemetry]);

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
        <span
          ref={statusTextRef}
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        />
      </div>
      {canvasElement}
    </div>
  );
}
