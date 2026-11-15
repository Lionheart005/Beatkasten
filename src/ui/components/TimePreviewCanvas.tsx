import { useEffect, useRef } from 'react';
import { defaultRegistry } from '../../core/defaultRegistry';
import type { TimeFrame } from '../../core/registry/types';
import type { LayerConfig } from '../../core/state/types';
import { cycleToBeats } from '../../core/theory/cycles';

interface TimePreviewCanvasProps {
  layer: LayerConfig;
  beatsPerBar: number;
  currentPhase?: number;
}

export function TimePreviewCanvas({
  layer,
  beatsPerBar,
  currentPhase = 0,
}: TimePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 260;
    const height = 62;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    const cycleBeats = cycleToBeats(
      layer.cycleLength.value,
      layer.cycleLength.unit,
      beatsPerBar,
    );

    const samples = 96;
    const energies = new Float32Array(samples);
    const triggers = new Float32Array(samples);

    let prevFrame: TimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: -1,
    };

    for (let i = 0; i < samples; i++) {
      const p = i / samples;
      let frame: TimeFrame = {
        warpedPhase: p,
        pulseEnergy: prevFrame.pulseEnergy,
        triggerIntensity: 0,
        accent: 0,
        stepIndex: prevFrame.stepIndex,
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
        const x = (i / (samples - 1)) * width;
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
  }, [beatsPerBar, currentPhase, layer.color, layer.cycleLength, layer.timeOperators]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-box"
      style={{ height: 62 }}
      title="Rhythmus-Vorschau über einen vollen Layer-Zyklus"
    />
  );
}
