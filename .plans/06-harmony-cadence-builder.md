# Erweiterungsplan: Dur, Jazz-Akkorde, Stufen-Baukasten & Stimmführung (Voice Leading)

> **Status**: Geplant (noch nicht umgesetzt). Umsetzung erfolgt nach Freigabe über `/delegate`.

## 1. Ziele & Überblick
1. **Vollständiges Skalen- & Akkord-Spektrum**: Klassisches Dur (Ionisch) sowie weitere Kirchentonarten (`Lydisch`, `Mixolydisch`) und Skalen (`Melodisch Moll`, `Dur-Pentatonik`), ergänzt um Akkorde von reinen Dreiklängen (`Dur`, `Moll`, `Vermindert`, `Übermäßig`, `Sus2`, `Sus4`) über Vierklänge (`Maj7`, `Dom7`, `Moll7`, `m7b5`, `6`, `add9`) bis hin zu Jazz-Erweiterungen (`9`, `11`, `13`).
2. **Klassische Kadenzen & moderne Folgen**: Deutlich größere Auswahl sofort spielbarer `PROGRESSION_PRESETS` (Vollkadenzen, `ii–V–I`, Pop/Melodic-Techno-Folgen, Andalusische Kadenz, Dorische/Lydische/Mixolydische Pendel).
3. **Einklappbarer „Akkord-Baukasten“ im UI**: Optional ein- und ausklappbarer Bereich zur freien Zusammenstellung beliebig langer Akkordfolgen auf Basis musikalischer Stufen (`I`–`VII` + chromatische Nebendominanten/Alterationen) mit individueller Beat-Dauer und einstellbarem Übergang pro Akkord.
4. **Automatische Stimmführung (Voice Leading) & Audio-Integration**: Nahtlose Stimmführung zwischen beliebigen Akkorden (inkl. Loop-Schluss vom letzten zurück zum ersten Akkord), Beat-genaues Harmonie-Timing in `TechnoEngine` und 6-stimmige Unterstützung in `ChordArpVoice` für volle `9`/`11`/`13`-Akkorde — **allokationsfrei im Audio-Thread** und voll an `HistoryTree`, Sections & Export angebunden.

---

## 2. Musiktheorie-Erweiterung (`src/core/theory/`)

### 2.1 Skalen (`src/core/theory/scales.ts`)
Erweiterung von `ScaleId` und `SCALE_DEFINITIONS` (alle bisherigen bleiben abwärtskompatibel erhalten):
- **Dur & helle Kirchentonarten**:
  - `major`: `Dur (Ionisch)` — `[0, 2, 4, 5, 7, 9, 11]`
  - `lydian`: `Lydisch` — `[0, 2, 4, 6, 7, 9, 11]`
  - `mixolydian`: `Mixolydisch` — `[0, 2, 4, 5, 7, 9, 10]`
  - `major_pentatonic`: `Dur-Pentatonik` — `[0, 2, 4, 7, 9]`
- **Moll & Jazz-Varianten (ergänzend zu `natural_minor`, `dorian`, `phrygian`, `harmonic_minor`, `minor_pentatonic`, `locrian`)**:
  - `melodic_minor`: `Melodisch Moll (Jazz-Aufwärts)` — `[0, 2, 3, 5, 7, 9, 11]`

Zusätzlich Export einer Hilfsfunktion `getDiatonicTriadOrSeventh(scaleId, degreeIndex)` (bestimmt für eine Skalenstufe `0..6` automatisch die leitereigene Intervallstruktur, z. B. in Dur: `I = Dur`, `ii = Moll`, `iii = Moll`, `IV = Dur`, `V = Dur/Dom7`, `vi = Moll`, `vii° = Vermindert`).

### 2.2 Akkordbibliothek (`src/core/theory/chords.ts` bzw. erweitert in `harmony.ts`)
Erweiterung von `ChordPresetId` & `CHORD_PRESETS` mit optionalem Metafeld `category: 'triad' | 'seventh' | 'extended'` und deutschem Musiker-Label:

| Kategorie | IDs & Intervalle (Halbtöne ab Grundton) |
|---|---|
| **Dreiklänge & Basis** | `major` (`Dur`: `[0,4,7]`), `minor` (`Moll`: `[0,3,7]`), `sus2` (`Sus2`: `[0,2,7]`), `sus4` (`Sus4`: `[0,5,7]`), `power5` (`Power 5`: `[0,7,12]`), `dim` (`Vermindert`: `[0,3,6]`), `aug` (`Übermäßig`: `[0,4,8]`) |
| **Vierklänge & Farben** | `maj7` (`Dur Maj7`: `[0,4,7,11]`), `dom7` (`Dominant 7`: `[0,4,7,10]`), `minor7` (`Moll 7`: `[0,3,7,10]`), `m7b5` (`Halbverm. m7b5`: `[0,3,6,10]`), `dim7` (`Verm. 7`: `[0,3,6,9]`), `minMaj7` (`Moll-Maj7`: `[0,3,7,11]`), `major6` (`Dur 6`: `[0,4,7,9]`), `minor6` (`Moll 6`: `[0,3,7,9]`), `add9` (`Dur add9`: `[0,4,7,14]`), `madd9` (`Moll add9`: `[0,3,7,14]`) |
| **Jazz Extensions (9, 11, 13)** | `maj9` (`Dur Maj9`: `[0,4,7,11,14]`), `dom9` (`Dom 9`: `[0,4,7,10,14]`), `minor9` (`Moll 9`: `[0,3,7,10,14]`), `dom7sus4` (`9sus4 / 7sus4`: `[0,5,7,10,14]`), `minor11` (`Moll 11`: `[0,3,7,10,14,17]`), `dom13` (`Dom 13`: `[0,4,7,10,14,21]` — ohne reibende 11), `maj13` (`Dur Maj13`: `[0,4,7,11,14,21]`), `minor13` (`Moll 13`: `[0,3,7,10,14,17,21]`) |

### 2.3 Erweiterte Kadenzen & Folgen (`PROGRESSION_PRESETS`)
- Bestehende Moll-Presets bleiben erhalten (`static`, `hypnotic_i_VI`, `classic_i_VI_VII_i`, `phrygian_i_II`).
- Neue Preset-Definitionen können optional pro Schritt `{ semitoneOffset, chordTypeOverride?, durationBeats }` tragen (Fallback auf gleichmäßige Takte für bestehende Presets):
  - **Dur-Vollkadenz**: `I – IV – V – I`
  - **Melodic / Pop-Kadenz**: `I – V – vi – IV`
  - **Jazz-Kadenz (Dur)**: `ii – V – I` (`m7 -> dom7/9 -> maj7`)
  - **Jazz-Kadenz (Moll)**: `ii° – V – i` (`m7b5 -> dom7 -> minor7/9`)
  - **Andalusische Kadenz**: `i – bVII – bVI – V`
  - **Dorischer Club-Vamp**: `i – IV` (`Moll7 -> Dur7`)
  - **Lydisches Schweben**: `Imaj7 – II`
  - **Mixolydischer Zug**: `I – bVII – IV – I`
  - **Pachelbel / Trance-Bogen**: `I – V – vi – iii – IV – I – IV – V`

---

## 3. Stimmführungs-Engine (Voice Leading) — `src/core/theory/voiceLeading.ts`

Ziel: Beim Wechsel von einem Akkord zum nächsten springen Stimmen nicht unmusikalisch um ganze Oktaven, sondern suchen die **kürzesten möglichen Wege** (gemeinsame Töne bleiben liegen, Leittöne lösen sich im Halbtonschritt auf).

### 3.1 Algorithmus (Vorberechnung bei Snapshot-Update)
1. **Stimmumfang-Anker (`voicingRange`)**: Standardmäßig z. B. MIDI `48` (`C3`) bis `76` (`E5`), damit Chords warm im Mittenbereich sitzen, während `bassMidi` eine Oktave tiefer (`36..47`) dem echten Grundton folgt.
2. **Kandidaten-Erzeugung je Akkord-Schritt**:
   - Für einen Akkord werden alle musikalisch sinnvollen Lagen und Umkehrungen innerhalb `[minMidi, maxMidi]` generiert (Grundstellung, 1.–3. Umkehrung, ggf. Drop-2-Spread bei 4–6 Stimmen).
   - Bei 6–7-stimmigen Jazz-Akkorden (`11`, `13`) wird optional auf die tragenden Stimmführungs-Töne (Terz/Septime + Tensions 9/13 + Quinte, max. 6 Oberstimmen) verdichtet, da der Grundton sauber im `bassMidi` liegt.
3. **Kostenfunktion zwischen Schritt `k-1` und `k`**:
   - **Pflicht**: Jeder Akkord muss mindestens Terz (bzw. Sus-Ton) und ggf. Septime/Optionston hörbar abbilden.
   - **Stimmbewegungs-Summe**: $\sum_i |\text{next}[i] - \text{prev}[i]|$ minimieren (Halbton-/Ganztonschritte bevorzugt, gemeinsame Töne mit Distanz `0` stark belohnt).
   - **Sprungstrafe**: Bewegungen $> 4$ Halbtöne in einer einzelnen Oberstimme werden quadratisch bestraft; leichte Gegenbewegung zum Bass-Schritt wird belohnt.
4. **Loop-Konsistenz (`Dynamische Programmierung / 2-Pass`)**:
   - Durchlauf 1 bestimmt eine optimale Start-Umkehrung für Schritt 0; Durchlauf 2 bewertet die komplette zyklische Kette inklusive des Rücksprungs `lastStep -> step[0]`, sodass sich auch das Ende einer Kadenz organisch wieder in den Anfang schmiegt.
5. **Ergebnisstruktur (`SolvedHarmonyStep`)**:
   - `{ startBeat, endBeat, durationBeats, rootNote, bassMidi, chordNotesMidi, nextChordNotesMidi, transitionType, transitionBeats, label }`.
   - Berechnet wird ausschließlich in `TechnoEngine.rebuildHarmonyCache(...)` (Zero-Allocation während `processBlock`!).

---

## 4. Datenmodell & State (`src/core/state/types.ts` & `src/core/registry/types.ts`)

### 4.1 Erweiterung von `BeatSnapshot['harmony']`
Abwärtskompatibel zu bestehenden JSON-/IndexedDB-Projekten:
```ts
export type ChordTransitionType = 'cut' | 'glide' | 'crossfade';

export interface ChordStepConfig {
  readonly id: string;
  readonly degree: number; // 0..6 (Stufe I..VII)
  readonly accidentalOffset: -1 | 0 | 1; // b, natur, #
  readonly chordType: ChordPresetId | 'auto'; // 'auto' = leitereigen zur Skala
  readonly durationBeats: number; // z. B. 1..32 Beats (Standard: 4)
  readonly transitionType: ChordTransitionType;
  readonly transitionBeats: number; // 0..2 Beats
}
```
In `BeatSnapshot['harmony']`:
- Bestehend: `rootNote`, `scaleId`, `chordType`, `progressionId`
- Neu (optional mit sauberen Defaults bei alten Projekten):
  - `progressionMode?: 'preset' | 'custom'` (Default `'preset'`)
  - `customSteps?: readonly ChordStepConfig[]`
  - `voiceLeadingEnabled?: boolean` (Default `true`)

### 4.2 Erweiterung von `HarmonyFrame` (`src/core/registry/types.ts`)
- Bestehend: `rootNote`, `rootMidi`, `scaleId`, `chordPreset`, `scaleNotesMidi`, `chordNotesMidi`
- Neu (optional, um Zero-Allocation-Caches sauber zu bedienen):
  - `readonly bassMidi?: number`
  - `readonly nextChordNotesMidi?: readonly number[]`
  - `readonly transitionType?: ChordTransitionType`
  - `readonly transitionProgress?: number` (`0..1` im Übergangsfenster am Ende des aktuellen Schritts)

---

## 5. Audio-Engine & Voices (`src/core/engine/` & `src/core/timbre/voices/`)

1. **Beat-genaues Harmonie-Timeline-Lookup in [TechnoEngine.ts](file:///c:/Users/leona/OneDrive/Dokumente/Programmier%20Projekte/TechnoSoundGenerator/src/core/engine/TechnoEngine.ts)**:
   - Statt nur `barIndex` zu indexieren, baut `rebuildHarmonyCache(snapshot)` ein vorallokiertes Array aus `SolvedHarmonyStep`s inkl. `totalProgressionBeats` auf.
   - In `renderChunk` wird `progBeat = beatPosition % totalProgressionBeats` mit dem aktuellen Schritt abgeglichen (monotoner Index-Cache für $O(1)$ im Normalbetrieb), `transitionProgress` ($0..1$) berechnet und in das vorallokierte `HarmonyFrame` geschrieben (keine Heap-Allokation pro Block).
   - Im `'preset'`-Modus mit `voiceLeadingEnabled === true` profitiert auch jedes Standard-Preset sofort von sauberer Stimmführung!
2. **6-stimmige Akkord-Polyphonie & Stimm-Übergänge in [ChordArpVoice.ts](file:///c:/Users/leona/OneDrive/Dokumente/Programmier%20Projekte/TechnoSoundGenerator/src/core/timbre/voices/ChordArpVoice.ts)**:
   - `NUM_VOICES` von `4` auf `6` erhöhen (damit Vierklänge + `9` + `11`/`13` vollständig klingen können; CPU-Auswirkung minimal, ~+2 leichte PolyBlep-Oszillatoren).
   - Unterstützung für `transitionType`:
     - `'cut'`: klassischer sauberer Akkordwechsel auf dem Beat.
     - `'glide'`: glättet die Zieltonhöhe jeder Stimme $v$ über die `transitionBeats`-Zeitkonstante direkt in Richtung `nextChordNotesMidi[v]` (oder direkt per Zielwechsel mit sanftem Portamento-Smoother).
     - `'crossfade'`: blendet weich über einen einstellbaren Übergangsparameter in das nächste Voicing über.
3. **[SubMotionVoice.ts](file:///c:/Users/leona/OneDrive/Dokumente/Programmier%20Projekte/TechnoSoundGenerator/src/core/timbre/voices/SubMotionVoice.ts) & [PulseTextureVoice.ts](file:///c:/Users/leona/OneDrive/Dokumente/Programmier%20Projekte/TechnoSoundGenerator/src/core/timbre/voices/PulseTextureVoice.ts)**:
   - Nutzen wie bisher `harmony.bassMidi ?? harmony.rootMidi`, folgen also exakt dem Grundton jedes Baukasten-Akkords (ohne von engen Akkordumkehrungen in die Höhe gezogen zu werden).

---

## 6. UI-Design: Einklappbarer Akkord-Baukasten (`src/ui/`)

1. **Sofort-Erweiterung in [TransportBar.tsx](file:///c:/Users/leona/OneDrive/Dokumente/Programmier%20Projekte/TechnoSoundGenerator/src/ui/panels/TransportBar.tsx)**:
   - Dropdowns `Skala`, `Akkord` und `Folge` zeigen ab sofort alle neuen Dur-/Modal-Skalen, Dur- bis Jazz-13-Akkorde (sauber per `<optgroup>` in Dreiklänge / Vierklänge / Jazz 9–13 gegliedert) und die erweiterten Kadenzen.
   - Neuer Toggle-Button rechts neben `Folge`: **`Baukasten ▼ / ▲`** (zeigt aktiv ein Badge wie `Aktiv · 16 Beats`, wenn `progressionMode === 'custom'`).
2. **Neues einklappbares Panel (`src/ui/panels/HarmonyBuilderPanel.tsx`)**:
   - Sitzt sauber als aufklappbare Leiste unterhalb von `.visual-center` (bzw. über dem Workspace), damit das Haupt-Layout kompakt bleibt, solange es zugeklappt ist.
   - **Kopfbereich**:
     - Umschalter: `Modus: Preset-Folge` vs. `Eigener Baukasten`
     - Schalter: `Stimmführung (Voice Leading)` An/Aus
     - Kadenzen-Vorlagen zum Laden in den Baukasten (`I–IV–V–I Dur`, `ii–V–I Jazz`, `i–VI–VII–i Techno`, `Andalusisch`, usw.)
     - **Stufen-Klickleiste**: Buttons **`I` `ii` `iii` `IV` `V` `vi` `vii°`** + **`bII`** **`bVI`** **`bVII`** (mit dynamischen Skalen-Akkordnamen als Sublabel, z. B. bei A-Moll: `i Am`, `III C`, `iv Dm`, `VI F`, `VII G`; bei C-Dur: `I C`, `ii Dm`, `IV F`, `V G`, `vi Am`). Jeder Klick hängt einen neuen Step an!
   - **Horizontale Step-Karten (mit Playhead-Highlight für den gerade aktiven Akkord)**:
     - Header: Stufen-Badge + errechneter Akkordname (z. B. `ii · Dm9`) + Aktionen (`←`, `→`, `Duplizieren`, `Löschen`)
     - Auswahl **Stufe / Alteration** (`I..VII`, `b/♮/#`)
     - Auswahl **Akkord-Farbe** (`Auto (Leiter)`, Dreiklänge, Vierklänge, Jazz `9 / 11 / 13`)
     - **Länge in Beats**: Quick-Chips (`2`, `4`, `8`) oder freies Zahlenfeld (`0.5..64 Beats`)
     - **Übergang**: `Schnitt` / `Glide` / `Blende` + Dauer (`0` – `1 Beat`)
     - **Voicing-Vorschau**: Live berechnete Töne (z. B. `Bass D2 · Voicing F3 – A3 – C4 – E4`), sodass man sieht, wie eng die Stimmführung arbeitet!
   - Alle Edits nutzen `commitSnapshotImmediate` / `updateSnapshotLive` -> voller Support für Undo/Redo (`Ctrl+Z`), History-Baum, Sections & Audio-Export.

---

## 7. Arbeitspakete (spätere Umsetzung via `/delegate`) & Verifikation

1. **WP-15 (Core Theory & Voice Leading, High)**: `scales.ts`, `chords.ts`/`harmony.ts`, `voiceLeading.ts` + erschöpfende Unit-Tests (`Dur/Moll/Jazz-Intervalle`, Stimmführungs-Distanz & Loop-Wrap, Beat-Timeline).
2. **WP-16 (Engine, Voices & State, High)**: `state/types.ts`, `registry/types.ts`, `TechnoEngine.ts` (Beat-genauer Harmonie-Scheduler ohne Allokation), `ChordArpVoice.ts` (6 Stimmen + `glide`/`crossfade`), `presets.ts`.
3. **WP-17 (UI & Akkord-Baukasten, High)**: `TransportBar.tsx`, `HarmonyBuilderPanel.tsx`, `App.tsx`, `useStudioStore.ts`, `styles.css` (einklappbar, aktives Step-Highlight über bestehendes `subscribeTelemetry` ohne Re-Render-Last!).
4. **Verifikation**: `tsc --noEmit`, alle Vitest-Unit- & DSP-Tests (inkl. Performance-Budget `< 1000 ms`), `vite build` und Live-Browser-Test mit Auf-/Zuklappen des Baukastens, Zusammenstellen einer `ii–V–I`-Jazz-Kadenz (`Dom13` -> `Maj9`) und Überprüfung der Stimmführung.
