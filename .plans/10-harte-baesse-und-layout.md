# 10 — Harte Bässe, Hardtechno-Demo & ziehbare Fenster

> Stand: 16.11.2026 · Umsetzung direkt durch Claude Opus 5.5 (kein /delegate).
> Bezug: `verbesserungen.txt` (Runde 4: Fenster per Maus vergrößern, Layer-Namen unlesbar) +
> Nutzerwunsch „mehr Bass (Drum & Sub-Melodie), weniger 90er-SciFi, mehr harter Techno“.

## Entscheidungen
- Neue Voices nutzen gemeinsame Helfer in `voices/voiceUtils.ts` (`BeatTracker` = Tempo aus `beatPosition`, `distort()` mit 5 Arten: Weich, Hart, Wavefold, Röhre, Bitcrusher) und `voices/bassNotes.ts` (`BassNotePicker` = Bass-Linien aus dem Melodie-Generator).
- `HarmonyFrame.keyRootMidi` (neu, optional): Grundton der TONART im Bassregister → Kick kann fest auf der Tonika bleiben statt mit jedem Akkord zu wandern.
- Fenstergrößen: `components/Splitter.tsx` (Pointer-Capture, Doppelklick = Standard), gespeichert in `localStorage` (`tsg.layout.*`). Unter 1120 px Breite ausgeblendet (einspaltiges Layout).

## Checkliste
- [x] `hard-kick` „Hardtechno-Kick & Rumble“ (`HardKickVoice.ts`): Punch/Fall-Geschwindigkeit, 5 Verzerrungs-Arten, Klick, tempo-synchrones Rumble (Menge, Länge, Dreck, Dunkelheit), „Tonhöhe folgt Tonart/Akkord“
- [x] `reese-bass` „Reese-Bass“ (`ReeseBassVoice.ts`): 3 verstimmte Sägen + mono Sub, 24-dB-Tiefpass, Wobble im Takt (1/1 … 1/16, Triole, 2 Takte), Verzerrung, Gleiten, Bass-Linien
- [x] `fm-bass` „Industrie-Bass (FM & Verzerrung)“ (`FmBassVoice.ts`): Verhältnis 0,5–7×, Grund-/Anschlag-Biss, Rückkopplung, Bitcrusher-Raster, Tonhöhen-Fall, sauberer Sub
- [x] `sub-motion`: neue Regler „Verzerrung (hart)“ und „Ton-Wahl“ (Automatisch / Fest / Oktav-Pendel / Quint-Pendel); Bugfix: Beat-Ducking rechnete fest mit 128 BPM → jetzt echtes Tempo
- [x] Demo „Stahlwerk“ (`state/hardTechnoDemo.ts`, 150 BPM, F-Phrygisch, 4×16 Takte) → `BeispielSetups/Projekte/Projekte/Stahlwerk/` + `exports/Stahlwerk_song.wav|mp3`, Preset-Chip „★ Hardtechno Stahlwerk“; `npx vite-node scripts/build-demo-song.ts --song=stahlwerk`
- [x] Ziehbare Fenster: Layer-Liste ↔ Inspector ↔ Abschnitte, die 3 Inspector-Säulen untereinander, Höhe der oberen Anzeige
- [x] Layer-Namen lesbar: 13 px, hell, bis zu 2 Zeilen; Knöpfe rutschen bei schmaler Liste in eine eigene Zeile
- [x] Tests **61/61**, `tsc` ✓, `vite build` ✓
- [ ] Hörtest & Bedientest im Browser durch den Nutzer

## Erkenntnisse
- Puls-Interferenz mit `freqA = 1` triggert nur einmal (Schritt-Index ändert sich nie) → für „1 Ton pro Takt“ Euklid 1 aus 4 verwenden (Reese im Break war in der Song-Kette sonst 7 dB zu leise).
- Tief gestimmte `metal-hat` verschwindet hinter ihrem eigenen Hoch-/Bandpass (−50 dB) → metallische Industrial-Percussion besser mit `fm-bass` (7×, Ton-Länge 0,06, Biss 1).
- Mix „Stahlwerk“ (Peak, RMS isoliert): Kick+Rumble −11 · Offbeat-Bass −21 · Acid −22 · Clap −25 · Percussion −30 · Hats −33 (24-kHz-Analyse); Song-Peak 0,84, 0 % Clipping, Break −16 dB.

## Nachtrag: Überschreib-Schutz für Projekte & Repo-Aufräumen
- Fehler: Projekt-Dialog „Neu“ übernahm den (vorbelegten) Namen des offenen Projekts → neues Projekt mit neuer ID, aber gleichem Ordnernamen → `saveProject` überschrieb den bestehenden Ordner („Stahlwerk“ wurde so ersetzt).
- Schutz 1 (Speicher): `BrowserFsAdapter.resolveOwnDirName` schreibt nie in einen Ordner, dessen `project.json` einer anderen Projekt-ID gehört → `Name_2`, `Name_3` … (Test `tests/unit/project-overwrite.test.ts`).
- Schutz 2 (App): `makeUniqueProjectName` (Ordner + Browser-Speicher, Vergleich wie im Dateisystem) bei Neu, Kopie, Umbenennen und Demo-Laden, mit Hinweis „… gibt es schon – heißt jetzt …“. „Neu“ mit unverändertem Namen legt „Neues_Projekt“ an.
- „Stahlwerk“ aus `hardTechnoDemo.ts` per `scripts/build-demo-song.ts --song=stahlwerk` wiederhergestellt.
- `BeispielSetups/` steht in `.gitignore` und ist aus dem Repository entfernt (lokal noch vorhanden; in der Git-Historie älterer Commits weiterhin enthalten).
