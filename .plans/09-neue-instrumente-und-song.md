# 09 — Neue Instrumente, Groove-Features, Song-Kette & Demo-Beat

> Stand: 16.11.2026 · Umsetzung direkt durch Claude Opus 5.5 (kein /delegate).
> Bezug: Nutzerauftrag „fehlende Instrumente & Features ergänzen, dann einen ausgewogenen Beat bauen“
> sowie offene Punkte aus [`verbesserungen.txt`](../verbesserungen.txt) und `implementation-status.md` §5.

## 1. Befund (was fehlte)
- Rhythmus nur über **eine** Voice (`pulse-texture` = Kick + Luft). Keine echte Hi-Hat, kein Clap/Snare → Groove klingt leer.
- Kein **Acid-/Resonanz-Bass** (das Techno-Instrument schlechthin), kein **Riser/Rausch-Aufbau** für Übergänge.
- Melodie-Voices (Glocke/Orgel) nur 4–5 starre Muster, kein Tempo, kein Zufall, keine Arpeggio-Bewegung (Wunsch aus `verbesserungen.txt`).
- Kein **Swing** und keine **Wahrscheinlichkeit/Ghost-Notes** → alles maschinell-starr, eintönig.
- Export nur je Abschnitt; **Song-Kette** fehlte (Wunsch aus `verbesserungen.txt`); Wiedergabe lief beim Export weiter.

## 2. Entscheidungen
- Alle neuen Module folgen dem bestehenden Registry-Muster (`ParameterSchema` mit deutschen Musiker-Texten, sinnvolle Grenzen, zero-alloc `process`).
- **Gemeinsamer Melodie-Generator** `src/core/theory/melody.ts` (pure Funktionen, keine Allokation): Modi + Tempo (`melodyRate`), Phrasenlänge, Würfel-Seed, Oktavsprünge, Akkordton-Bindung. Alte Muster-Indizes bleiben klanglich identisch (Abwärtskompatibilität alter Projekte), neue Modi hängen hinten an.
- Neue Zeit-Operatoren: `time-swing` (Phasen-Warp, muss **vor** Puls-Generatoren stehen) und `time-chance` (Maske **nach** Puls-Generatoren). Neue Layer bekommen beide (aus) in der Kette; alte Layer über „+“-Knopf in Säule 1.
- Song-Kette: ein durchlaufender `TechnoEngine`, an Abschnittsgrenzen `applySnapshot` (Hallfahnen laufen weiter, kein Knacksen).

## 3. Checkliste
- [x] Melodie-Generator `src/core/theory/melody.ts` + Integration in Glocke & Orgel (Modi 5–13: Skala ab, auf&ab, Akkord-Arpeggio auf/ab/Pendel, Würfel, Spaziergang, Motiv-Entwicklung, Ruf & Antwort; Regler Melodie-Tempo, Phrasen-Länge, Würfel, Oktavsprünge, Akkordton-Bindung, Pausen/Haltebögen). Orgel bekam zusätzlich `melodyRange` und Modus 4 (Duett).
- [x] Voice `metal-hat` „Hi-Hat & Becken“ (`MetalHatVoice.ts`)
- [x] Voice `clap-snare` „Clap & Snare“ (`ClapSnareVoice.ts`)
- [x] Voice `acid-line` „Acid-Linie (303-Stil)“ (`AcidLineVoice.ts`, nutzt Melodie-Generator, gewürfelte Akzente/Slides)
- [x] Voice `noise-riser` „Rausch-Welle (Riser)“ (`NoiseRiserVoice.ts`, folgt der Layer-Phase)
- [x] Zeit-Operatoren `time-swing`, `time-chance` (`time/operators.ts`); neue Layer haben beide (aus) in der Kette; `insertTimeOperator` + `OPTIONAL_TIME_OPERATORS` in `presets.ts`, „+“-Knöpfe in Säule 1
- [x] Song-Kette: `renderSongChain` (`OfflineRenderer.ts`), `ExportRequest.songChain/tailBars`, Export-Modal „Ganzer Song“, Wiedergabe stoppt beim Export
- [x] UI Abschnitte: aktiver Abschnitt hervorgehoben („● aktiv · sync“), ↑↓ verschieben, Auto-Sync (Checkbox, 700 ms verzögert), Layer aus Abschnitt kopieren (inkl. referenzierter Kurven) — `useStudioStore.ts` (`activeSectionId`, `moveSection`, `copyLayerFromSection`, `cloneLayerWithNewIds`), `SectionsAndHistoryPanel.tsx`
- [x] Demo-Song „Nachtschicht“ (`src/core/state/demoSong.ts`): Projektordner `BeispielSetups/Projekte/Projekte/Nachtschicht/` + `exports/Nachtschicht_song.wav|mp3` (4:04 min) via `npx vite-node scripts/build-demo-song.ts`; Preset-Chip „★ Demo-Song Nachtschicht“ lädt ihn als neues Projekt
- [x] Tests (`tests/unit/new-instruments.test.ts`, **55/55**), `tsc --noEmit` ✓, `vite build` ✓
- [ ] Hörtest im Browser durch den Nutzer (neue Voices, Melodie-Modi, Abschnitts-Sync, Song-Export)

## 4. Erkenntnisse
- Drei ältere Tests (Render-Budget 1000 ms, 5-s-Timeouts) schlagen unter Last auf diesem Rechner auch OHNE die Änderungen fehl (Baseline per `git stash` geprüft) – Laufzeit ~2,3 s statt < 1 s. Im ruhigen Lauf bestehen sie. Kein Regress.
- Mix-Analyse (`scripts/build-demo-song.ts --analyze`, RMS je Layer isoliert): Ausgangslage Kick −13 dB, Hats −40 dB (viel zu leise, Mix dumpf). Daraufhin `MetalHatVoice`-Ausgang +6,5 dB, `AcidLineVoice` +3,8 dB und Layer-Pegel angepasst → Peak: Kick −13,7 · Bass −18 · Acid −23 · Clap −25 · Glocke/Stab −27 · Hats −28; Höhen (>5 kHz) ≈ 13 dB unter Gesamt; Peak 0,86, 0 % Clipping; Break ≈ 6,5 dB leiser als Peak.
- Song-Kette: `MasterClock.seekToBeat` akzeptiert keine negativen Beats → Vorlauf startet auf kgV(Volle Wiederholung des 1. Abschnitts, 64 Takte), damit Takt 1 musikalisch Takt 1 ist. Abschnittslängen als Vielfache von 16 Takten halten Riser/Wirbel (16-Takt-Zyklen) synchron.
- Layer mit gleichen IDs über alle Abschnitte → Engine verwendet Instanzen weiter, Hall/Echo laufen beim Abschnittswechsel durch.
