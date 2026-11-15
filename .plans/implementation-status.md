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
- [ ] **WP-1 (`gemini-4-hydrogen-medium`)**: Projekt-Setup (`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`), Installation von Dependencies (`react`, `react-dom`, `vitest`, `@vitest/ui` / `jsdom`, `lucide-react`, `@playwright/test` oder Browser-Verification-Check, MP3-Encoder-Lib) & Ordner-Gerüst.
- [ ] **WP-2 (`gemini-4-hydrogen-medium`)**: `src/core/registry/` + `src/core/theory/` + `src/core/math/` (Skalen, Akkorde, kgV/LCM, periodische Wellen, `TimeWarp`, `PulseInterference`, `GridGravity`, `PhaseDrift`, `DrawnCurve`-Evaluator).
- [ ] **WP-3 (`gemini-4-hydrogen-high`)**: `src/core/dsp/` (Zero-Allocation DSP-Bausteine: `OnePoleSmoother`, `DCBlocker`, `PolyBlepOscillator`, `SVFilter` TPT/ZDF, `SoftSaturator` mit Auto-Gain, `Wavefolder`, `SandReducer`, `TunedBodyResonator`, `TiltEQ`, `Musical3BandEQ`, `StereoOrbit` mit Mono-Sub `<110Hz`, `TempoSyncDelay`, `DuckingReverb` Hadamard FDN, `MasterBus`).

### Welle 2: Domänen-Module, Engine, State & Storage
- [ ] **WP-4 (`gemini-4-hydrogen-high`)**: `src/core/time/` + `src/core/timbre/` (`PulseTextureVoice`, `SubMotionVoice`, `ChordArpVoice`, sowie die Drag-&-Drop-Karten `ToneFilterCard`, `WarmthWavefoldCard`, `BodySandCard`, `EqOrbitCard`, `TempoEchoCard`, `DuckingHallCard`) + zentrale `DefaultRegistry`.
- [ ] **WP-5 (`gemini-4-hydrogen-high`)**: `src/core/modulation/` (`ModulationRouter` inkl. Wave-LFO, Layer-to-Layer-Puls, Drawn-Curve `+`/`×`, Macro-Arc und 1-Pass Modulation-on-Modulation) + `src/core/engine/` (`MasterClock`, `LayerEngine`, `TechnoEngine` mit Crossfade-Smoothing & Telemetry, `OfflineRenderer` für Loops & Stems).
- [ ] **WP-6 (`gemini-4-hydrogen-medium`)**: `src/core/state/` (`ProjectDocument`, `BeatSnapshot`, `HistoryTree` DAG, Starter-Presets *„Hypnotic A-Moll Club“*, *„Triolen-Rätsel 5/4“*, *„Akkord → Offbeat Arp“*) + `src/core/export/` (`encodeWav`, `encodeMp3`) + `src/storage/` (`ProjectStorageAdapter`, `IndexedDbAdapter`, `BrowserFsAdapter`).

### Welle 3: Audio-Host & Komplette UI
- [ ] **WP-7 (`gemini-4-hydrogen-high`)**: `src/audio-host/` (`WorkletProcessor.ts`, `AudioBridge.ts`, `ExportWorker.ts`, `ScopeTelemetry`) + vollständige `tests/unit/**` & `tests/dsp/**` Suite.
- [ ] **WP-8 (`gemini-4-hydrogen-high`)**: `src/ui/` — Studio-Dark-Interface für Musiker:
  - Transport/Harmony-Bar, Quick-Presets, Export-Dialog (Loop/Stems, WAV/MP3, Pre-Roll), Projekt-Ordner-Verwaltung
  - Live **Phasen-Radar** (Canvas mit `kgV`-Anzeige) + **Live-Wellenform-Scope**
  - **Layer-Stack** (Add/Duplicate/Delete, Mute/Solo/Level/Pan, Cycle-Ratio, Voice-Wahl)
  - **3-Säulen-Inspector**: Zeit-Operatoren + **Drag-&-Drop Klang-Kartenkette** + **Bewegungs-Anker (`~`)** an jedem Regler + **Interaktiver Kurven-Zeichner** (`+`/`×`, Raster-Snap, Hover-Bögen)
  - **Section-Manager** (Song-Abschnitte ohne Timeline + takt-quantisiertes Live-Umschalten) & **Verzweigter History-Baum** (Bookmarks, A/B-Vergleich)

### Welle 4: Integration, E2E-Verifikation & Feinschliff
- [ ] **WP-9 (`gemini-4-hydrogen-high`)**: Kompletter Build (`tsc --noEmit`, `vite build`), alle `vitest`-Tests + Browser-Smoke-/AudioWorklet-Verifikation & Behebung eventueller Integrationsfehler.

## 4. Gefundene Fehler, Probleme & Wichtige Erkenntnisse
- **Umgebungs-Check (15.11.2026)**: `node` & `npm` sind installiert (`C:\Program Files\nodejs\`), `git` noch nicht initialisiert.

## 5. Ausstehende Arbeitsschritte & Nächste Schritte
1. `git init` im Workspace ausführen, damit diffs & saubere Checkpoints verfügbar sind.
2. Welle 1 starten (`WP-1` → dann `WP-2` & `WP-3` parallel mit disjunkten Dateien).
