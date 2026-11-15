# Performance-Optimierungsplan (Low-End / Laptop-Tauglichkeit)

## 1. Analyse der Ursachen
- **UI-/Cursor-Stocken**: `useStudioStore` speicherte die ~62,5 Hz Audio-Telemetrie im React-Root-State (`setTelemetry`), wodurch die gesamte App (inkl. ~30 Regler-Komponenten) 62x pro Sekunde neu gerendert wurde. Gleichzeitig berechnete `TimePreviewCanvas` bei jedem Playhead-Tick die komplette 256-Sample-Kurve über alle `timeOperators` neu.
- **Audio-Thread-Overhead**: `WorkletProcessor` kopierte bei jedem Telemetry-Tick `scopeL`/`scopeR` (2×128 Werte, im UI ungenutzt) sowie `layerPhases`/`layerEnergies` über `Array.from(...)` (Heap-Allokationen & GC-Druck im Echtzeit-AudioWorklet).

## 2. Arbeitspakete (`/delegate`)

### WP-12: Zero-Allocation AudioWorklet & Schlanke Telemetrie (`src/core/engine/TechnoEngine.ts`, `src/audio-host/`)
1. `TechnoEngine`: Ungenutzten Scope-Ringpuffer (`scopeL`, `scopeR`, `updateScope`) aus dem heißen Audio-Block entfernen.
2. `WorkletProcessor.ts`:
   - `TELEMETRY_INTERVAL_BLOCKS` von `6` (~62,5 Hz) auf `10` (~37,5 Hz bei 48 kHz / 128 Samples) erhöhen.
   - `scopeL`/`scopeR` aus `WorkletOutboundMessage` entfernen.
   - Vorallokierte `phaseScratch`/`energyScratch`-Arrays beim Befüllen wiederverwenden statt `Array.from(...)` pro Tick zu allokieren.
3. `AudioBridge.ts`: `LiveTelemetry` auf die tatsächlich genutzten Felder verschlanken (`isPlaying`, `currentBeat`, `currentBar`, `combinedCycleBeats`, `layerPhases`, `layerEnergies`, `peakLevel`).

### WP-13: Null-Re-Render-UI & Offscreen-Kurven-Cache (`src/ui/`)
1. `useStudioStore.ts`: `telemetry` aus React `useState` entfernen; stattdessen `subscribeTelemetry` + `getTelemetry` direkt über `AudioBridge` exponieren (während Play entstehen **0 Root-Re-Renders/s**).
2. `TransportBar.tsx`: Pegel-Balken direkt per DOM-Ref (`meterFillRef`) aktualisieren.
3. `PhaseRadarCanvas.tsx`: Telemetrie direkt abonnieren, Radar per `requestAnimationFrame` neu zeichnen und Takt/Beat-Text per DOM-Ref aktualisieren.
4. `TimePreviewCanvas.tsx`: Statische 256-Punkt-Kurve + Trigger-Spitzen in einem Offscreen-`<canvas>` cachen und nur bei Layer-/Parameter-/Größenänderung neu berechnen; während der Wiedergabe per `requestAnimationFrame` nur Offscreen-Bild blitten + Playhead-Strich zeichnen + Status-Text per DOM-Ref setzen.
5. Ungenutzte `src/ui/components/WaveformScopeCanvas.tsx` entfernen.

## 3. Erfolgskriterien
- `npx tsc --noEmit` Exit `0`
- `npx vitest run` alle Tests grün (`< 1000 ms` 10s-48kHz-Render-Budget)
- `npx vite build` Exit `0`
- Live-Browser-Verifikation auf `http://localhost:5173/`: **0 Konsolenfehler**, laufender Playhead/Radar/Pegel ohne Root-Re-Render-Stutter.
