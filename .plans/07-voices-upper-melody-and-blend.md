# Erweiterungsplan (Welle 7): Oberstimmen-Voices (`Glocke & Mallet`, `Orgelpipes`) & Dual-Voice-Kombination

> **Abgrenzung**: Dieser Plan setzt **nur** die neuen Oberstimmen-Voices, Melodie-Muster für Offbeat-/Einzeltöne und die Dual-Voice-Kombination um. Der größere Akkord-/Stufen-Baukasten ([`06-harmony-cadence-builder.md`](./06-harmony-cadence-builder.md), Welle 6) bleibt bewusst unberührt für später.

## 1. Ziele
1. **Echte Einzel- & Intervall-Oberstimmen (keine Akkorde)**: Stimmen schöpfen direkt aus `ctx.harmony.scaleNotesMidi` in wählbarer Oktavlage und Melodie-Bewegung (Einzelton, Pendel, Skala aufwärts, Sprung-Rätsel, Quinte/Terz-Duett) — ideal für Offbeat-Töne.
2. **Spezialisierte Instrumentenfarben**:
   - **`ModalBellVoice` (`modal-bell` — „Glocke & Mallet“)**: Inharmonische/FM-Partial-Synthese von warmer Holz-Marimba/Kalimba über glasiges Vibraphon bis kristallines Glockenspiel mit realistischem Oberton-Abklingen und Hammer-Anschlag.
   - **`PipeOrganVoice` (`pipe-organ` — „Orgelpipes & Zugriegel“)**: Additive Register-Synthese (`16'`, `8'`, `4'`, `2 2/3'`, `2'`, `1 3/5'`) mit Pfeifen-Anblas-Chiff, Stereo-Pfeifen-Breite, Tremulant und umschaltbarem `Einzelton` / `Duett` / `Orgel-Akkord`-Modus.
3. **Dual-Voice-Kombination (Stimmen kombinieren)**: Jeder Layer bekommt eine optionale **Stimme B (`secondaryVoice`)** mit eigenem Modul, Mix-Balance (`0..100 %`) und modulierenbaren Parametern (`targetCardId = 'secondary-voice'`) vor der Effekt-Kette.
4. **Neues Starter-Preset**: `Glocken & Orgel` (`createBellsAndOrganPreset`) demonstriert 4/4-Kick + Offbeat-Glockenspiel + dual-kombinierte Orgelpipes.

## 2. Arbeitspakete (`/delegate`)

### WP-18 (`gemini-4-hydrogen-high`): Neue Oberstimmen-Voices (`src/core/timbre/voices/`)
- `src/core/timbre/voices/ModalBellVoice.ts` (`modal-bell`)
- `src/core/timbre/voices/PipeOrganVoice.ts` (`pipe-organ`)
- Export & Registrierung in `src/core/timbre/voices/index.ts` und `src/core/defaultRegistry.ts`.
- Strikte Vorgaben: Zero Heap-Allocations in `process()`, saubere `OnePoleSmoother`, DC-Blocker gegen Offset, `scaleNotesMidi`-Melodie-Auswahl + 4–6 polyphone Ausklang-Stimmen für überlappende Offbeat-Glocken/Orgelpfeifen ohne Abschneiden.

### WP-19 (`gemini-4-hydrogen-high`): Dual-Voice-Engine & Preset (`src/core/state/`, `src/core/engine/`, `tests/`)
- `src/core/state/types.ts`: Optionales `secondaryVoice?: SecondaryVoiceConfig` auf `LayerConfig`.
- `src/core/engine/LayerEngine.ts`: Verwaltung von `secondaryVoiceInstance`, vorallokierte `secSubBufsL`/`secSubBufsR`, glatter `secondaryMixSmoother`, Modulation auf `targetDomain = 'voice', targetCardId = 'secondary-voice'`.
- `src/core/state/presets.ts` (+ `src/core/state/index.ts`): Export von `createBellsAndOrganPreset()`.
- `tests/dsp/engine-sanity.test.ts`: Test-Abdeckung für `modal-bell`, `pipe-organ`, `secondaryVoice`-Blend (Zero-NaN/Headroom/DC) sowie `createBellsAndOrganPreset()`.

### WP-20 (`gemini-4-hydrogen-high`): UI für Dual-Voice-Kombination & Starter-Preset (`src/ui/`)
- `src/ui/store/useStudioStore.ts`: Actions für `secondaryVoice` (Toggle, Voice-Wechsel, Live-/Commit-Mix & Parameter) sowie 4. Preset-Key `'bells-organ'`.
- `src/ui/panels/LayerInspector.tsx`: Ausklappbare Sektion „+ Zweite Stimme einmischen (Kombination)“ in Säule 2 unter der Haupt-Voice (mit `~`-Modulationsankern auf `secondary-voice`).
- `src/ui/components/ModulationDrawer.tsx`: Erkennung von `targetCardId === 'secondary-voice'` für saubere Routen-Beschriftung.
- `src/ui/panels/TransportBar.tsx`: 4. Preset-Button `Glocken & Orgel`.
