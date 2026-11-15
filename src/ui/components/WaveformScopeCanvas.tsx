import { useEffect, useRef } from 'react';
import type { LiveTelemetry } from '../../audio-host';

interface WaveformScopeCanvasProps {
  telemetry: LiveTelemetry;
  isPlaying: boolean;
}

export function WaveformScopeCanvas({
  telemetry,
  isPlaying,
}: WaveformScopeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = 84;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Subtle studio grid
    ctx.strokeStyle = 'rgba(161, 174, 198, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    for (let i = 1; i < 4; i++) {
      const x = (width * i) / 4;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    const left = telemetry.scopeL;
    const right = telemetry.scopeR;
    const n = Math.min(left.length, right.length);

    if (n > 1) {
      // Right channel (subtle purple)
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const y = height / 2 - (right[i] ?? 0) * (height * 0.42);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Left channel (crisp cyan)
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const y = height / 2 - (left[i] ?? 0) * (height * 0.42);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    ctx.restore();
  }, [telemetry]);

  return (
    <div className="visual-card">
      <div className="scope-wrap">
        <div className="scope-header">
          <span style={{ fontWeight: 600, color: '#eef2f9' }}>
            Stereo-Oszilloskop (L/R)
          </span>
          <span>
            {isPlaying
              ? `Pegel ${(telemetry.peakLevel * 100).toFixed(0)} %`
              : 'Bereit — Play drücken'}
          </span>
        </div>
        <canvas
          ref={canvasRef}
          className="canvas-box"
          style={{ height: 84 }}
        />
      </div>
    </div>
  );
}
