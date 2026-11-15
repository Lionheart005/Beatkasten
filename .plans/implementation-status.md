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

## 4. Gefundene Fehler, Probleme & Wichtige Erkenntnisse
- **Umgebungs-Check (15.11.2026)**: `node` v26.9.0 & `npm` 12.2.0 installiert; `git` mit Initial-Commit (`048322d`) eingerichtet.
- **MP3-Export**: `@breezystack/lamejs` (`^1.2.7`) installiert und im ESM-Context getestet (`Mp3Encoder` funktioniert sauber).
- **Wichtige Typ- & Performance-Notizen**:
  - `CycleUnit` in `src/core/theory/cycles.ts` lautet `'beats' | 'bars'`.
  - `evaluateDrawnCurve` in `curves.ts` allokiert intern Arrays; `ModulationRouter` bäckt gezeichnete Kurven vorab in 512-Punkt-`Float32Array`-LUTs (Zero-Allocation im Audio-Thread).
  - Bei 48 kHz führten 8-Sample-Control-Subblocks + unindexierte Modulations-Scans zu ~7,5 s Renderzeit pro 10 s Stereo-Audio. Durch `CONTROL_SUBBLOCK_SIZE = 32`, `hasTargetRoutes`-Vorabindizierung in `ModulationRouter`, zero-alloc `evaluateTimeInto` und Fast-Paths für eingeschwungene `OnePoleSmoother` sank die Laufzeit im Supervisor-Testlauf auf `934 ms` (< 1000 ms Budget, >10x Realtime).

## 5. Ausstehende Arbeitsschritte & Nächste Schritte
1. Optional: Akustischer Hörtest durch den Benutzer im laufenden Browser (`http://localhost:5173/`) und bei Bedarf Fein-Tuning von Starter-Presets oder neuen Klang-Karten.
2. Bei Bedarf `git status` prüfen und einen sauberen Meilenstein-Commit anlegen.
