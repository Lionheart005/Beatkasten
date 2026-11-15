# 08 — Feedback-Runde 2 (verbesserungen.txt) + Umsetzung Kadenz-Baukasten (Welle 6)

> Stand: 15.11.2026 · Umsetzung direkt durch den Supervisor (kein /delegate).
> Bezug: [`verbesserungen.txt`](../verbesserungen.txt), [`06-harmony-cadence-builder.md`](./06-harmony-cadence-builder.md)

## 1. Analyse der Anmerkungen (Ursachen)

| # | Anmerkung | Ursache / Befund | Lösung |
|---|---|---|---|
| A | Glocken: verzerrt, nicht entfernbar, an andere Layer gebunden, gemeinsam ausgewählt | **Hauptursache: doppelte Layer-IDs.** `presets.ts → nextId()` zählt ab 0 pro Seitenladen (`layer_1`, `layer_2`…). Ein aus IndexedDB geladenes Projekt hat dieselben IDs → neuer Layer kollidiert. Folgen: gemeinsame Auswahl, `deleteLayer` filtert beide/falsche, `TechnoEngine.layerEngineCache` & `ModulationRouter.layerCaches` teilen sich eine Instanz → doppelt gerendert = Verzerrung/Chaos. Zusätzlich DSP: `tanh`-Übersteuerung bei 6 überlappenden Slots, Slot-Stealing mit Phasen-Reset (Klicks), Ausklang-Schwelle 1e-6 (Slots nie frei), lauter Sinus-Chirp. | (1) global eindeutige IDs (`Date.now`+Zufall), (2) `repairProjectIds()` beim Laden (aktiver Snapshot, History, Sections), (3) Glocken-DSP: Headroom-Gain, 8 Slots, Schwelle 1e-4, leiser Klick statt Chirp, kein Phasen-Reset. |
| B | Säule 2: Regler ziehen verschiebt die Karte | Karte hat `draggable` → Slider-Drag startet HTML5-Drag | Drag & Drop entfernt, nur Pfeile. ✅ |
| C | Arpeggio-Tempo schneller | `arpSpeed.max = 8` relativ zur Zykluslänge | `max = 32` + neuer Regler **Arp-Raster** (frei / 1/4 … 1/64, Triolen) beat-synchron; Frequenz-Snap bei schnellen Steps (kein Portamento-Verschmieren). |
| D | Export-Loop länger | Slider max 32 Takte; Pre-Roll verschiebt Loop-Start (Loop startete in Takt 3!) | Zahlenfeld bis 256 Takte + Chips (8/16/32/64/128) + „Volle Wiederholung (kgV)“; Pre-Roll per Clock-Seek, sodass der Loop auf einem Vielfachen der Loop-Länge beginnt. |
| E | Projekt speichern unübersichtlich (Unterordner „Projekte“, Doppelspeicherung) | Adapter legt immer `Projekte/` im gewählten Ordner an (→ `Projekte/Projekte/...`); Umbenennen = neuer Ordner mit gleicher ID; kein sichtbarer Speicherstatus | Gewählter Ordner **ist** der Projekte-Ordner (Legacy: vorhandener `Projekte/`-Unterordner wird weiter genutzt); Umbenennen verschiebt Ordner; Liste dedupliziert nach ID; Speicherstatus-Chip in der Transportleiste („✓ Automatisch gespeichert 18:05 · Ordner/Projekt“); Ordner-Handle wird in IndexedDB gemerkt (Wiederverbinden mit einem Klick). |
| F | Layer als Gruppen organisieren & verschieben | fehlt | `LayerConfig.group?: string`; Gruppen-Köpfe (ein-/ausklappen, umbenennen, Mute/Solo für Gruppe), ↑/↓ für Layer und ganze Gruppen. |
| G | Melodie zu eintönig | Harmonie wechselte nur taktweise mit 4 Legacy-Folgen, Akkordtyp global | Welle 6: Kadenz-Baukasten (siehe 06) |

## 2. Entscheidungen (Welle 6 – Kadenz-Baukasten)
- **Einheitliches Step-Modell** (`src/core/theory/progression.ts`): Legacy-Presets (`semitoneOffsets`, paralleler Akkordtyp = „Techno-Parallel“) bleiben klanglich erhalten; neue Kadenzen sind **stufenbasiert** (`degree`, `accidental`, `chordType: 'auto' | ChordPresetId`, `durationBeats`).
- `chordType: 'auto'` = leitereigener Akkord; die globale „Akkord“-Auswahl bestimmt die Farbe (3 Töne → Dreiklang, 4 → Septakkord, ≥5 → None).
- **Akkord-Skala**: Melodie-Voices bekommen pro Akkord die Tonart-Skala, in der leiterfremde Akkordtöne den nächstliegenden Skalenton ersetzen (bVI, bII klingen nicht schief).
- **Bass**: `rootMidi` = Grundton im Bereich Tonika −6…+5 Halbtöne (Legacy-kompatibel für A).
- **Stimmführung**: zyklisches Viterbi über Voicing-Kandidaten (Umkehrungen × Oktavlagen × Drop-2), Kosten = Stimmbewegung + Sprungstrafe + Registerdrift; Loop-Schluss letzter→erster Akkord inklusive.
- **Engine**: Beat-genaue Timeline, Chunks werden an Akkordgrenzen geteilt, während Übergängen max. 256 Samples; `transitionProgress` in einem vorallokierten Live-Frame (zero alloc).
- **ChordArpVoice**: 6 Stimmen (Schleifen statt Unrolling), `glide` (Tonhöhen-Gleiten) und `crossfade` (sich ändernde Stimmen blenden aus, gemeinsame Töne bleiben liegen).
- Kombinierter Zyklus (Telemetrie/Export „Volle Wiederholung“) berücksichtigt die Länge der Akkordfolge.

## 3. Checkliste
- [x] B: Drag & Drop in Säule 2 entfernt (`LayerInspector.tsx`, CSS bereinigt)
- [x] A: eindeutige IDs (`presets.ts` Session-Salt) + `state/repair.ts` (`repairSnapshotIds`/`repairProjectIds`, beim Laden aus IDB/Ordner) + Glocken-DSP (`ModalBellVoice.ts`: 8 Slots, Release −80 dB, Headroom, Klick statt Chirp, Höhen-Fold ≤ MIDI 96, konsonantere Partials)
- [x] C: `arpSpeed.max = 32`, neuer Regler `arpGrid` (Frei, 1/4 … 1/64, Triolen), Frequenz-Snap bei Steps < 90 ms
- [x] D: Export bis 256 Takte (Zahlenfeld + Chips + „Volle Wiederholung“ via `engine/cycleMath.ts → computeFullRepeatBars`), Pre-Roll per `MasterClock.seekToBeat`
- [x] E: Ordnerlogik (`BrowserFsAdapter`: gewählter Ordner = Projekte-Ordner, Legacy-`Projekte/` wenn befüllt, Umbenennen verschiebt Ordner inkl. Exports, Liste dedupliziert, verwaiste Section/Kurven-Dateien werden entfernt, Section-Reihenfolge per Dateipräfix), Speicherstatus-Chip + Projekt-Dialog neu, Ordner-Handle in IndexedDB (`settings`-Store, DB v2), serialisiertes Autosave
- [x] F: `LayerConfig.group`, `ui/store/layerGroups.ts`, Gruppen-Köpfe (ein-/ausklappen, Doppelklick-Umbenennen, ↑↓, M/S), ↑↓ je Layer
- [x] G1: Theorie: 5 neue Skalen, 26 Akkorde mit Kategorien, 11 Kadenz-Presets, `progression.ts`, `voiceLeading.ts`
- [x] G2: `TechnoEngine` Beat-Timeline (Chunks an Akkordgrenzen, ≤ 256 Samples im Übergang), `ChordArpVoice` 6 Stimmen + Glide/Blende, kombinierter Zyklus inkl. Akkordfolge
- [x] G3: `HarmonyBuilderPanel.tsx` (Stufen-Leiste inkl. bII/bIII/bVI/bVII, Step-Karten mit Alteration/Stufe/Farbe/Länge/Übergang/Voicing-Vorschau, Playhead-Highlight, Vorlagen laden), `TransportBar` (optgroups, Baukasten-Schalter)
- [x] Verifikation: `tsc --noEmit` ✓, `vitest run` **41/41** ✓ (neu: `tests/unit/feedback-round2.test.ts`, Kadenz-Tests in `theory-math.test.ts`), `vite build` ✓ (Worklet ohne DOM-Referenzen)
- [ ] Live-Hörtest im Browser durch den Nutzer (Glocken, Baukasten, Speichern mit echtem Ordner)

## 3b. Nachtrag (Runde 2b, 15.11.2026): Euklid + Baukasten-Ausbau
- [x] Neuer Zeit-Operator `time-euclid` „Euklidischer Rhythmus“ (`time/operators.ts`): Steps 1–32, Schläge (modulierbar), Verschiebung (modulierbar), Ton-Länge, Akzent auf Schlag 1, Modus „Eigener Puls“ / „Maske über Puls-Interferenz“. Echte Bjorklund-Muster als vorberechnete Tabelle (5/8 = `x.xx.xx.`).
- [x] Engine: pro Operator-Slot ein `Float64Array`-Gedächtnis (`TimeEvalContext.slotState`) + `hasPulseSource`; Operatoren bleiben zustandslos/geteilt. `time-euclid` zählt als Puls-Generator (LayerEngine + TimePreviewCanvas).
- [x] Neue Layer haben den Operator (aus) in der Kette; bestehende Layer: Knopf „+ Euklidischer Rhythmus“ in Säule 1; Vorlagen-Chips (Tresillo, Cinquillo, Bossa, Samba, Aksak …) + Step-Anzeige; klassische Rhythmus-Presets schalten ihn aus.
- [x] Baukasten: bis 128 Akkorde, Haltedauer 0,5–128 Beats pro Akkord (Chips 1/2/4/8/16 + Zahlenfeld + Takt-Anzeige), Vorwahl von Farbe & Länge für neue Akkorde, „Alle = X Beats“, „Folge ×2“, Übersichtsleiste (Breite = Dauer, Playhead), umbrechende Karten.
- [x] Übermäßige Akkorde: `aug` (+), `aug7` (7♯5), `augMaj7` (maj7♯5), `aug9` (9♯5), `augMaj9` (maj9♯5); Stufen-Symbol `III+`, `V+7`.
- [x] Stimmführung für lange Ketten: weniger Start-Kandidaten (>12: 4, >32: 2, >64: 1) und max. 12 Voicings pro Akkord ab 17 Akkorden → 128 × 13er-Akkorde ≈ 4–5 ms (einmalig pro Harmonie-Änderung).
- [x] Tests: `tests/unit/euclid-and-builder.test.ts` (**46/46** gesamt), `vite build` ✓.

## 4. Erkenntnisse
- Doppelte Layer-IDs wirken sich dreifach aus: UI-Auswahl, `TechnoEngine.layerEngineCache` (doppeltes Rendern einer Instanz) und `ModulationRouter.layerCaches`. IDs müssen über Seitenladen hinweg eindeutig sein.
- `applySnapshot` läuft bei jeder Reglerbewegung im Audio-Thread → Harmonie-Timeline nur bei geändertem `JSON.stringify(harmony)` neu lösen. Worst case (32 Akkorde, 13er) ≈ 4 ms einmalig pro Harmonie-Änderung.
- Legacy-Folgen (`group: 'techno'`) transponieren weiter die Skala mit dem Akkordgrundton (bisheriger Klang bleibt erhalten); Einzelakkord-Folgen behalten das alte Grundstellungs-Voicing.

## 5. Offene Ideen (an Nutzer zur Entscheidung)
siehe `implementation-status.md` Abschnitt 5.
