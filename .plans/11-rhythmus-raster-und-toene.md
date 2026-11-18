# 11 — Rhythmus-Raster, Töne halten, fester Ton, Bass-Spalte & geordnete Klang-Regler

> Stand: 18.11.2026 · Umsetzung direkt durch Claude Opus 5.5 (kein /delegate).
> Bezug: `verbesserungen.txt` (Runde 5).

## Wünsche → Lösung

| # | Wunsch | Lösung (Kurzform) |
|---|---|---|
| 1 | Alle Instrumente sollen Töne aushalten können | Neues **Gate-Signal** im `TimeFrame` (`gate` 0/1 = „Taste gedrückt“). Rhythmus-Raster liefert es (Ton-Länge + **Haltebögen** über mehrere Steps). Alle Anschlag-Instrumente bekommen den gemeinsamen Regler **„Halten (Sustain)“** (0 = One-Shot wie bisher, 1 = Ton steht, solange die Note gehalten wird). Flächen-Instrumente (Akkord, Orgel, Sub, Riser) folgen der Kurve direkt. |
| 2 | Instrument von den Akkorden abkoppeln, beliebiger Einzelton | `LayerConfig.pitch = { mode: 'harmony' \| 'fixed', note, octave }`. LayerEngine baut bei „Fester Ton“ ein eigenes, vorab berechnetes Harmonie-Frame (Grundton, Akkord = 1 Ton, Skala = nur dieser Ton) → gilt automatisch für Stimme A + B, alle Instrumente. UI: Gruppe „Tonhöhe“ in Säule 2. |
| 3 | Bass-Spalte im Akkord-Baukasten (Umkehrungen, grundtonlose Akkorde) | `ChordStepConfig.bass` (`root` / `third` / `fifth` / `seventh` / `degree` + `bassDegree`/`bassAccidental` / `none`) + `omitRoot`. `HarmonyFrame.bassMidi` = echter Basston, `bassRest` = Bass pausiert. Bass-Instrumente (Kategorie `bass`) spielen `bassMidi` (LayerEngine tauscht generisch), bei `none` blendet LayerEngine sie weich aus. Akkord-Instrumente lassen bei `omitRoot` den Grundton im Voicing weg. Akkordname mit Slash (`C/E`). UI: eigene Bass-Zeile in jeder Akkord-Karte + Bass-Spur in der Übersichtsleiste. |
| 4/5 | „Wann“-Spalte überarbeiten: Unterteilungen wählen, Beats per Klick setzen; Gravitation & obsolete Regler weg; Spitze/Kantigkeit, Ausklang, Zeitverzögerung, Swing/Shuffle, Zufall, Drift bleiben | Neuer Operator **`time-step-grid` „Rhythmus-Raster“**: 1–64 Steps, Klick-Raster mit Werkzeugen *Schlag / Akzent / Halten* (Ziehen = malen), Muster als Bitmasken (`patA/B`, `accA/B`, `tieA/B`, versteckte Parameter). Regler: Ton-Länge, Spitze (Kantigkeit), Ausklang, Verzögerung (früher ↔ später), Verschiebung (Rotation), Akzent-Stärke, Zusatz-Schläge (Euklid, modulierbar). Werkzeuge: Leeren, Alle, Umkehren, ←/→, „Euklid verteilen“. Vorlagen-Chips (Four-on-the-Floor, Offbeat, Tresillo …). Puls-Interferenz, Raster-Gravitation und Euklid verschwinden aus der UI; Zeit-Krümmung bleibt optional („+“). Swing, Zufall, Drift bleiben als Groove-Karten. |
| 6 | Klang-Einstellungen vereinheitlichen & ordnen | `ParameterSchema.group` (`pitch` Tonhöhe · `tone` Klangfarbe · `envelope` Anschlag & Länge · `drive` Verzerrung · `motion` Bewegung · `space` Stereo · `melody` Melodie). Alle 12 Instrumente zugeordnet, Bezeichnungen vereinheitlicht (Helligkeit, Länge (Ausklang), Stimmung, Oktavlage, Verzerrung, Stereo-Breite …), feste Reihenfolge. UI zeigt Gruppen mit einklappbaren Köpfen (gemerkt). IDs bleiben gleich → alte Projekte kompatibel. |

## Entscheidungen
- **Migration statt Parallelbetrieb**: Alte Projekte (IndexedDB/Ordner, History, Abschnitte) werden beim Laden in `state/timeMigration.ts` auf das Raster umgerechnet (Puls-Interferenz wird abgetastet und auf das passende Raster quantisiert, Euklid → Bitmuster, Gravitation entfällt, Routen auf Euklid-Schläge → „Zusatz-Schläge“). Die alten Operatoren bleiben im Registry registriert (Sicherheitsnetz), werden aber nicht mehr angeboten.
- **Presets/Demos** werden intern noch mit der alten Kette gebaut (`createDefaultLayer(..., { legacyTime: true })`) und am Ende migriert → identischer Weg wie geladene Projekte, Demo-Rhythmen bleiben erhalten.
- „Zeitverzögerung“ = Regler **Verzögerung** im Raster (Bruchteil eines Steps, später/früher). Zeit-Krümmung bleibt zusätzlich als optionale Groove-Karte.
- Hüllkurve des Rasters (pro Schlag): Anstieg = (1−Spitze)²·0,5 Steps (Kosinus), Halten bis Ton-Länge bzw. Ende der Haltebögen, dann Ausklang über *Ausklang* Steps mit Kurve (1−x)^(0,6+2,4·Spitze). Vorheriger Ausklang wird nicht abgeschnitten (max).
- Bass-Instrumente = Voice-Kategorie `bass` (Sub, Acid, Reese, FM). Kick bleibt beim Akkord-/Tonart-Grundton.

## Checkliste
- [x] Typen: `TimeFrame.gate`, `ParameterSchema.group/hidden`, `HarmonyFrame.bassRest`, `LayerConfig.pitch`, `ChordStepConfig.bass*/omitRoot`
- [x] `time-step-grid` Operator + `gate` in allen Operatoren + `isPulseGeneratorModule`
- [x] LayerEngine: Gate-Default, fester Ton (eigenes Frame), Bass-Sicht + Bass-Pause
- [x] Theorie: Bass-Spalte & grundtonlose Akkorde in `progression.ts`, TechnoEngine reicht `bassMidi`/`bassRest` durch
- [x] Migration `timeMigration.ts` + Einbindung beim Laden + Presets/Demos
- [x] Voices: „Halten (Sustain)“ in Kick, Puls, Hat, Clap, Acid, Reese, FM, Glocke; Gruppen + Labels für alle 12
- [x] UI: Säule 1 neu (Raster-Editor), Tonhöhe/fester Ton, gruppierte Klang-Regler, Bass-Zeile im Baukasten
- [x] Tests anpassen + neue Tests, `tsc`, `vitest`, `vite build`

- [x] Browser-Check (headless Chrome über DevTools-Protokoll gegen `npm run dev`): Raster-Vorlagen, Haltebogen malen, Fester Ton, Baukasten-Bass (Umkehrung `Am7/C`, Pause, freier Basston, ohne Grundton) – 0 Konsolenfehler
- [ ] Hörtest durch den Nutzer (v. a. migrierte Demos „Nachtschicht“/„Stahlwerk“ und alte Projekte)

## Erkenntnisse
- Ergebnis: **76/76 Tests** (neu: `tests/unit/feedback-round5.test.ts`, 15 Tests), `tsc` ✓, `vite build` ✓ (Worklet ohne DOM-Referenzen).
- Der Performance-Test (10 s / 4 Layer < 1000 ms) ist auf diesem Rechner lastabhängig: alter Stand 1138 ms, neuer Stand 1097 ms im Einzellauf → keine Verschlechterung durch das Raster.
- Zeit-Operatoren arbeiten mit doppelt gepufferten Frames: **jeder** Operator muss `outFrame.gate` schreiben, sonst bleibt ein Wert von vor zwei Auswertungen stehen.
- Raster mit 1 Step: Schritt-Wechsel allein reicht nicht → Zyklus-Sprung über die Phase (u springt zurück) erkennen, sonst nur 1 Schlag insgesamt (gleiches Problem wie früher bei Puls-Interferenz freqA = 1).
- Bitmasken als Parameter: `2 ** i` statt `1 << i` (Bit 31 wäre sonst negativ), Lesen mit `>>> 0`.
- Bass-Instrumente sehen über `LayerEngine.bassView` den echten Basston als `rootMidi` → keine Änderung an den einzelnen Bass-Voices nötig; „Kein Bass“ blendet in ~18 ms aus.
- Migrierte Puls-Interferenz wird abgetastet und auf das kleinste passende Raster (Fehler < 0,15 Step) quantisiert; Gipfel-Unterschiede > 15 % werden zu Akzenten.
- Offene Ideen: Playhead im Raster-Editor; „Tonart-Grundton“ als dritte Ton-Quelle (wie Kick „Tonhöhe folgt“) für alle Instrumente; Umkehrung auch für die Oberstimmen erzwingen.
