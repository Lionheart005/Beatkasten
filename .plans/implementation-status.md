# TechnoSoundGenerator — Umsetzungs- & Übergabeplan (`/delegate`)

## 1. Ziel & Kontext
- Vollständige Umsetzung des modularen, timeline-freien Techno-Beat- & Klangstruktur-Generators auf Basis der Pläne [`00-overview-and-vision.md`](./00-overview-and-vision.md) bis [`04-testing-and-roadmap.md`](./04-testing-and-roadmap.md).
- Fokus auf dem **3-Säulen-Modell (`Zeit` × `Klang` × `Bewegung`)**, geordneter **Drag-&-Drop-Kartenkette** statt Node-Spaghetti, **Kreuz-Modulation** (Layer-zu-Layer & Welle-auf-Welle), verzweigter History, Song-Abschnitten, Projekt-Ordnerstruktur und WAV/MP3-Export.

## 2. Architektur & Getroffene Entscheidungen
- **Single-Root Vite + TypeScript + React + Vitest**: Vermeidet Windows/OneDrive-Symlink-Probleme von npm Workspaces und garantiert sauberes Bundling von `AudioWorkletProcessor` und Web Worker unter Vite. Strikte Import-Grenze: `src/core/**` importiert niemals DOM-, React-, Storage- oder Web-Audio-APIs.
- **Orthogonales Registry-System**: Alle Voices, Time-Operatoren und Shaper-/Effekt-Karten registrieren sich über `ModuleDescriptor` + `ParameterSchema` (inkl. `min`/`max` Sweet-Spot-Grenzen, `modulatable`, `domain`, deutscher Musiker-Beschreibung).
- **Klang-Kartenkette statt freiem Node-Graph**: Jede Layer-Signal-Kette ist lückenlos verbunden, Karten lassen sich per Drag & Drop umsortieren und einzeln bypassen/einfügen; komplexe Wechselwirkungen laufen sicher über `ModulationRouter`.
- **MP3 + WAV Export**: Nativer 24-bit/16-bit RIFF WAV Encoder (Pure TS) + MP3-Encoding (Web Worker / `@breezystack/lamejs` bzw. `lamejs` ESM-kompatibel).
- **UI-Sprache & Bedienung**: Konsequent musiktheoretische / sinnliche Bezeichnungen auf Deutsch (mit knappen Erklärungen, ohne Audio-Ingenieur-Fachchinesisch).

## 3. Umsetzung & Arbeitsstand (Supervisor + Hydrogen-Worker)

### Welle 1: Projekt-Grundgerüst & Basiskern
- [x] **WP-1 (`gemini-4-hydrogen-medium`)**: Projekt-Setup (`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`), Installation von Dependencies (`react`, `react-dom`, `lucide-react`, `@breezystack/lamejs`, `vitest`, `jsdom`, `@testing-library/react`, `@types/node`) — verifiziert (`tsc --noEmit`, `vite 6.4.6`, `vitest 3.2.7`).
- [x] **WP-2 (`gemini-4-hydrogen-medium`)**: `src/core/registry/` + `src/core/theory/` + `src/core/math/` (Skalen, Akkorde, kgV/LCM mit `CycleUnit = 'beats' | 'bars'`, periodische Wellen, `warpPhase`, `interferenceEnergy`, `gridGravityPull`, `phaseDriftOffset`, `evaluateDrawnCurve` mit Catmull-Rom + 5 Presets).
- [x] **WP-3 (`gemini-4-hydrogen-high`)**: `src/core/dsp/` (Zero-Allocation DSP-Bausteine: `OnePoleSmoother`, `DCBlocker`, `PolyBlepOscillator`, `WhiteNoiseGenerator`, `ZdfSvfFilter`, `TiltEQ`, `Musical3BandEQ`, `SoftSaturator` mit Auto-Gain, `Wavefolder`, `SandReducer`, `TunedBodyResonator`, `LR4SubMonoCrossover`, `StereoOrbit`, `TempoSyncDelay`, `DuckingReverb` 4-ch Hadamard FDN, `MasterBus`).

### Welle 2: Domänen-Module, Engine, State & Storage
- [x] **WP-4 (`gemini-4-hydrogen-high`)**: `src/core/time/` (4 Zeit-Operatoren), `src/core/timbre/` (`PulseTextureVoice`, `SubMotionVoice`, `ChordArpVoice`, sowie die 6 Drag-&-Drop-Karten `card-tone-filter`, `card-warmth-wavefold`, `card-body-sand`, `card-eq-orbit`, `card-tempo-echo`, `card-ducking-hall`) + `src/core/defaultRegistry.ts` — `tsc --noEmit` bestanden.
- [x] **WP-5 (`gemini-4-hydrogen-high`)**: `src/core/modulation/` (`ModulationRouter` mit vorab berechneten 512er-Kurven-LUTs, Layer-zu-Layer Sidechain & 1-Pass Modulation-on-Modulation) + `src/core/engine/` (`MasterClock`, `LayerEngine` mit `card.id`-Instanz-Reuse, `TechnoEngine` mit 15-ms-Crossfade & Telemetry, `OfflineRenderer` für Loops & Stems) — `tsc --noEmit` + Laufzeit-Check bestanden.
- [x] **WP-6 (`gemini-4-hydrogen-medium`)**: `src/core/state/` (`types.ts`, `HistoryTree.ts`, `presets.ts` inkl. 3 Starter-Presets & Sections) + `src/core/export/` (`encodeWav`, `encodeMp3`) + `src/storage/` (`ProjectStorageAdapter`, `IndexedDbAdapter`, `BrowserFsAdapter`) — `tsc --noEmit` bestanden.

### Welle 3: Audio-Host, Test-Suite & Komplette UI
- [x] **WP-7 (`gemini-4-hydrogen-high`)**: `src/audio-host/` (`WorkletProcessor.ts`, `AudioBridge.ts`, `ExportWorker.ts`, `exportService.ts`) + `tests/unit/**` & `tests/dsp/**` (23 Tests über 4 Testdateien).
- [x] **WP-8 (`gemini-4-hydrogen-high`)**: `src/ui/` (Komplettes Musiker-Studio-UI mit Phasen-Radar, Waveform-Scope, Layer-Stack, 3-Säulen-Inspector, Drag-&-Drop Kartenkette, Bewegungs-Anker `~`, Kurven-Zeichner, Sections, History-Tree, Ordner-Speicher & WAV/MP3-Export).

### Welle 4: Integration, Performance-Optimierung & Verifikation
- [x] **WP-9 (`gemini-4-hydrogen-high`)**:
  - `src/core/math/curves.ts`: Periodic-Wrap-Korrektur für Catmull-Rom-Stützpunkte (`theory-math.test.ts` 8/8 bestanden).
  - DSP- & Engine-Hotpath-Optimierung (`CONTROL_SUBBLOCK_SIZE = 32` bei 0,67 ms Control-Rate, zero-alloc `evaluateTimeInto` in `src/core/time/operators.ts`, pre-indexierte Target-Buckets in `src/core/modulation/ModulationRouter.ts`, Smoother-Fast-Paths in `src/core/dsp/` und `src/core/timbre/`): 10s-48kHz-4-Layer-Renderzeit von `~7546 ms` auf **`934 ms`** gesenkt (Vitest 4/4 Dateien, **23/23 Tests** bestanden).
  - Kompletter TypeScript- & Production-Build (`tsc --noEmit` Exit 0, `vite build` Exit 0 inkl. eigenständigem ES-Bundle `dist/assets/WorkletProcessor-*.js` ohne `window`/`document`-Referenzen).
  - **Live-Browser-Verifikation in Chrome abgeschlossen**:
    - Inline-SVG-Favicon in `index.html` ergänzt (eliminiert `/favicon.ico` 404).
    - Hard Reload auf `http://localhost:5173/`: **0 Konsolenfehler**, **0 fehlgeschlagene Network-Requests** (`91/91` HTTP 200).
    - `AudioWorklet` (`WorkletProcessor.ts`) startete per Play-Klick fehlerfrei (`Phasen-Radar` Takt/Beat, `Stereo-Oszilloskop`, Pegelanzeige und Live-Preset-Wechsel aktiv getestet).
    - Interaktive Flows geprüft: Modulations-Drawer `~`, Kurven-Zeichner (`Kurve 2` / `Freihand` / `Triolen-Welle`), Starter-Presets (`Triolen-Rätsel 5/4`, `Akkord → Offbeat Arp`, `Hypnotic A-Moll Club`) sowie `Von Takt 1 neu starten` / `Stop`.
    - Echter Browser-Export via Web Worker (`ExportWorker.ts` + `@breezystack/lamejs` für `MP3 192 kbps (Kompakt)`, 2 Takte Loop + 2 Takte Pre-Roll): abgeschlossen mit `Fertig gerendert (3.7 s Audio).` und direktem Download bei **0 Konsolen-/Worker-Fehlern**.
- [x] **WP-10 (`gemini-4-hydrogen-high`)**: Mathematische Bereinigung der Zeit-/Interferenz-Trigger (`src/core/math/timeMath.ts`, `src/core/time/operators.ts`, `src/core/registry/types.ts`, `src/core/engine/LayerEngine.ts`, `src/core/state/presets.ts`, `tests/unit/theory-math.test.ts`):
  - `interferenceEnergy` auf Cosinus-Ausrichtung (`Math.cos`) umgestellt (Welle-A-Gipfel exakt auf den Zählzeiten `k / freqA`, bei `Welle B Anteil <= 0.0001` komplette Abschaltung von Welle B) + analytische Steigung `interferenceSlope` (`pulseSlope` in `TimeFrame`).
  - Intuitive `0`-Defaults (`Gravitation = 0`, `Welle B Anteil = 0`, `Versatz = 0`, `Auslöse-Schwelle = 0`, `min = 0`) sowie saubere Peak-/Step-Trigger-Logik ohne Flankendrift und ohne Doppeltrigger.
  - Verifiziert per 2-Takt-On-Beat-Regressionstest in `theory-math.test.ts` (**24/24 Vitest-Tests** bestanden, 10s-48kHz-Render-Budget `925 ms`).
- [x] **WP-11 (`gemini-4-hydrogen-high`)**: Obere `Wellenfunktion`-Anzeige & `Four-on-the-Floor`-Presets (`src/ui/components/TimePreviewCanvas.tsx`, `src/ui/App.tsx`, `src/ui/panels/LayerInspector.tsx`):
  - `WaveformScopeCanvas` im oberen `visual-center` durch hochauflösendes (`256`-Sample + `ResizeObserver`) `TimePreviewCanvas` für den jeweils ausgewählten Layer ersetzt (`Wellenfunktion · <Layer>` bleibt beim Scrollen in Säule 1 stets sichtbar); doppelte kleine Vorschau aus Säule 1 entfernt und `applyRhythmPreset` für `Four-on-the-Floor` & Co. bereinigt.

### Welle 5: Laptop-Performance & Zero-Re-Render-UI ([`05-performance-optimization.md`](./05-performance-optimization.md))
- [x] **WP-12 (`gemini-4-hydrogen-high`)**: Zero-Alloc AudioWorklet-Telemetrie & Entfernung des ungenutzten Scope-Ringpuffers (`TechnoEngine.ts`, `WorkletProcessor.ts` mit `TELEMETRY_INTERVAL_BLOCKS = 10` & Scratch-Arrays, `AudioBridge.ts`).
- [x] **WP-13 (`gemini-4-hydrogen-high`)**: Entkopplung der Live-Telemetrie vom React-Root-State (`useStudioStore.ts`, `App.tsx`, `TransportBar.tsx` mit `meterFillRef`, `PhaseRadarCanvas.tsx` via `rAF` + DOM-Ref) + Offscreen-Kurven-Cache (`bgCanvasRef`) im `TimePreviewCanvas.tsx` + Entfernung von `WaveformScopeCanvas.tsx`.
- [x] **WP-14 (`gemini-4-hydrogen-medium`)**: Korrektur der Kurven-Zykluslänge (`ModulationRouter.ts`, `TechnoEngine.ts`, `ModulationDrawer.tsx`, `CurveDrawCanvas.tsx`, `tests/unit/theory-math.test.ts`), sodass bei `Gezeichnete Kurve` (`drawn-curve`) immer die aktuelle Dauer der Kurve (`entry.curve.cycleValue`/`cycleUnit`, z. B. `10 Beats`) statt eines veralteten `4`-Beat-LFO-Werts auf der Route greift (**25/25 Vitest-Tests**).

### Welle 6 (Abgeschlossen, Claude Opus 5.5 direkt): Harmonie-, Kadenz- & Stimmführungs-Baukasten ([`06-harmony-cadence-builder.md`](./06-harmony-cadence-builder.md))
- [x] **WP-15**: Dur/Lydisch/Mixolydisch/Melodisch Moll/Dur-Pentatonik, 26 Akkorde (`Dur` bis `13`), 11 Kadenzen, `progression.ts` + `voiceLeading.ts`.
- [x] **WP-16**: Beat-genauer Harmonie-Scheduler in `TechnoEngine.ts` (zero-alloc Live-Frame) + 6-stimmige `ChordArpVoice.ts` mit `glide`/`crossfade`.
- [x] **WP-17**: `HarmonyBuilderPanel.tsx` + gruppierte Skalen/Akkorde/Folgen in `TransportBar.tsx`.

### Welle 8 (Abgeschlossen): Feedback-Runde 2 ([`08-feedback-runde-2.md`](./08-feedback-runde-2.md))
- [x] Doppelte Layer-IDs (Glocken-Bug) + Reparatur alter Projekte, Glocken-DSP, Säule-2-Drag entfernt, Arp bis 1/64, Export bis 256 Takte + „Volle Wiederholung“ + Pre-Roll-Fix, Speichern/Ordner-UX, Layer-Gruppen (**41/41 Vitest-Tests**, `vite build` ✓).
- [x] Nachtrag: Euklidischer Rhythmus-Operator (`time-euclid`), Baukasten bis 128 Akkorde × 0,5–128 Beats, übermäßige Akkorde (**46/46 Vitest-Tests**).

### Welle 7 (Abgeschlossen): Oberstimmen-Voices & Dual-Voice-Kombination ([`07-voices-upper-melody-and-blend.md`](./07-voices-upper-melody-and-blend.md))
- [x] **WP-18 (`gemini-4-hydrogen-high`)**: `ModalBellVoice` (`modal-bell` / `Glocke & Mallet`) & `PipeOrganVoice` (`pipe-organ` / `Orgelpipes & Zugriegel`) inkl. Registrierung in `defaultRegistry.ts`.
- [x] **WP-19 (`gemini-4-hydrogen-high`)**: `LayerConfig.secondaryVoice` in `state/types.ts`, Zero-Alloc Dual-Voice-Blend in `LayerEngine.ts`, `createBellsAndOrganPreset()` & DSP-Tests (**26/26 Vitest-Tests**).
- [x] **WP-20 (`gemini-4-hydrogen-high`)**: UI-Kombination (`Stimme B (Kombination)`) in `LayerInspector.tsx`, `useStudioStore.ts`, `ModulationDrawer.tsx` & Preset-Chip `Glocken & Orgel` in `TransportBar.tsx`.
- [x] **WP-21 (`gemini-4-hydrogen-high`)**: Dauerhaft durchgängige Orgel-/Layer-Modi & präzise Wellenformung >16 Beats (`droneHold` in `PipeOrganVoice.ts`, flacher `pulseEnergy = 1`-Bypass in `LayerEngine.ts`/`TimePreviewCanvas.tsx`, `waveShape` für steile Spitzen & hartes Rechteck-Ein/Aus in `timeMath.ts`/`operators.ts` sowie Anhebung `freqA`/`freqB`/`subdivisions` `max` auf `64`; **29/29 Vitest-Tests**).
- [x] **WP-22 (`gemini-4-hydrogen-medium`)**: `Dauerton (Durchgehend)` (`droneHold`) auch in `ChordArpVoice.ts` (`Akkord & Arpeggio`) und voller Dauerton-Floor ab `Halte-Energie > 0.85` in `SubMotionVoice.ts` (`Sub-Bewegung`; **30/30 Vitest-Tests**).
- [x] **WP-23 (`gemini-4-hydrogen-medium`)**: Bugfix für `Dauerton = 0` (echte rhythmische Pausen in den Wellentälern statt ungewolltem Dauerklang in `PipeOrganVoice.ts`, `ChordArpVoice.ts` und `SubMotionVoice.ts`), `-0`-Slope-Fix in `operators.ts`, Worklet-Cache-Busting in `AudioBridge.ts` sowie Start-Anleitung in `Kontext.txt` (**30/30 Vitest-Tests**).
- [x] **WP-24 (`gemini-4-hydrogen-medium`)**: Modulierbare Layer-Lautstärke (`Pegel` / `level`) & Layer-Panorama (`Pan` / `pan`) über `targetDomain: 'voice'`, `targetCardId: 'layer-mix'` in `LayerEngine.ts` (zero-alloc Subblock-Smoothing), `LayerStackPanel.tsx` (`~`-Buttons neben `Pegel` & `Pan`), `CurveDrawCanvas.tsx` (`Ziel-Regler`-Dropdown), `ModulationDrawer.tsx` & `SchemaControl.tsx` (**31/31 Vitest-Tests**).

### Welle 9 (Abgeschlossen, Claude Opus 5.5 direkt): Neue Instrumente, Groove, Song-Kette & Demo-Song ([`09-neue-instrumente-und-song.md`](./09-neue-instrumente-und-song.md))
- [x] Voices `metal-hat`, `clap-snare`, `acid-line`, `noise-riser`; gemeinsamer Melodie-Generator (`theory/melody.ts`) für Glocke, Orgel, Acid.
- [x] Zeit-Operatoren `time-swing` (Swing & Shuffle) und `time-chance` (Zufall & Ghost-Notes).
- [x] Song-Kette-Export, Wiedergabe-Stopp beim Export, aktiver Abschnitt + Auto-Sync + Verschieben + Layer-Kopie aus Abschnitten (Punkte aus `verbesserungen.txt`).
- [x] Demo-Song „Nachtschicht“ (Projektordner + WAV/MP3 + Preset-Chip), **55/55 Vitest-Tests**, `vite build` ✓.

## 4. Gefundene Fehler, Probleme & Wichtige Erkenntnisse
- **Ursache für unregelmäßigen `Four-on-the-Floor` (gelöst in WP-10/WP-11)**: `interferenceEnergy` verwendete vorher `Math.sin` (startete auf der Zählzeit bei `0.5` unipolar statt auf dem Gipfel `1.0`), `time-pulse-interference` feuerte teils doppelt (`crossedThreshold` + `steppedInEnergy`) und `Four-on-the-Floor` mischte `freqB = 1` (`0.2`) + `threshold = 0.52` + `gravity = 0.9` ein. Durch Cosinus-Ausrichtung, analytische Wellenkamm-Erkennung (`pulseSlope`), `0`-Defaults und sauberes Preset läuft `Four-on-the-Floor` jetzt exakt auf Beat 1, 2, 3, 4.
- **Umgebungs-Check (15.11.2026)**: `node` v26.9.0 & `npm` 12.2.0 installiert; `git` mit Initial-Commit (`048322d`) eingerichtet.
- **MP3-Export**: `@breezystack/lamejs` (`^1.2.7`) installiert und im ESM-Context getestet (`Mp3Encoder` funktioniert sauber).
- **Wichtige Typ- & Performance-Notizen**:
  - `CycleUnit` in `src/core/theory/cycles.ts` lautet `'beats' | 'bars'`.
  - `evaluateDrawnCurve` in `curves.ts` allokiert intern Arrays; `ModulationRouter` bäckt gezeichnete Kurven vorab in 512-Punkt-`Float32Array`-LUTs (Zero-Allocation im Audio-Thread).
  - Bei 48 kHz führten 8-Sample-Control-Subblocks + unindexierte Modulations-Scans zu ~7,5 s Renderzeit pro 10 s Stereo-Audio. Durch `CONTROL_SUBBLOCK_SIZE = 32`, `hasTargetRoutes`-Vorabindizierung in `ModulationRouter`, zero-alloc `evaluateTimeInto` und Fast-Paths für eingeschwungene `OnePoleSmoother` sank die Laufzeit im Supervisor-Testlauf auf `934 ms` (< 1000 ms Budget, >10x Realtime).

## 5. Ausstehende Arbeitsschritte & Nächste Schritte
1. Hörtest durch den Benutzer im Browser (`npm run dev`): Glocken, Akkord-Baukasten (Glide/Blende), Speichern mit echtem Ordner, langer Export.
2. Meilenstein-Commit (noch nicht erfolgt – nur auf Wunsch).
3. **Vorgeschlagene nächste Features gegen Eintönigkeit (Entscheidung durch Nutzer offen):**
   - **Motiv-Entwicklung** für Glocke/Orgel: deterministische Variation pro Phrase (Transposition, Umkehrung, Krebs, Ruf & Antwort alle 4/8 Zyklen) – wiederholt sich erst nach langer Periode.
   - **Fill/Turnaround-Takt**: letzter Takt jeder 4/8/16-Takt-Phrase variiert automatisch (Dichte, Oktave, Filter).
   - **Seed-Zufall mit Periode** („Würfel“ der sich nach N Takten wiederholt): Ghost-Notes, Note-Auslassung, Velocity.
   - **Song-Kette**: Sections mit Taktanzahl hintereinander abspielen und als ein langes WAV exportieren.
   - **Akkord-Melodie-Kopplung**: Glocke trifft auf betonten Zählzeiten Akkordtöne, dazwischen Durchgangstöne.
