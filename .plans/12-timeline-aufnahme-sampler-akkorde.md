# 12 — Zweiter Workspace „Timeline“, Audio-Spuren & Aufnahme, Sample-Instrument, klassische Akkorde

> Stand: 18.11.2026 · **Umgesetzt** (Phasen A–F) · offen: Browser-Check/Hörtest durch den Nutzer · Bezug: `verbesserungen.txt` (Runde 6)
> Entscheidungen des Nutzers (18.11.2026):
> - **Tempo:** Ein Song-Tempo für die ganze Timeline, alle Abschnitte passen sich an. Tempo- und Taktartwechsel als Marker auf der Zeitleiste.
> - **Reihenfolge:** A Akkorde → B Timeline-Kern → C Effekte/Keyframes/Übergänge → D Audio-Spuren → E Aufnahme → F Sample-Instrument.

---

## 0. Wünsche → Lösung (Kurzüberblick)

| # | Wunsch (aus `verbesserungen.txt`) | Lösung (Kurzform) | Phase |
|---|---|---|---|
| 1 | Zweiter, eigener Workspace mit Timeline, Abschnitte aneinanderreihen | Workspace-Umschalter „Beatkasten \| Timeline“. Timeline-Spuren enthalten **Abschnitts-Clips**, die live auf die Abschnitte des Beatkastens verweisen. Eigene `ArrangementEngine` (reines TS, live und Export identisch). | B |
| 2 | Effekte drüberlegen, mit Kurven über die Zeit (Keyframes statt Loop) | Effekt-Kette pro Spur und auf dem Master (die vorhandenen Klang-Karten wiederverwendet). Jeder Regler kann eine **Automationsspur** mit Keyframes bekommen (linear / weich / halten / exponentiell), in Song-Zeit, ohne Wiederholung. | C |
| 3 | Übergänge wie Fade u. ä. | Clip-Fades (Anfasser am Clip), automatische Überblendung bei Überlappung, **Übergangs-Vorlagen** (Filter-Fahrt, Echo-Ausklang, Hall-Wash, Break, Bremse/Tape-Stop, Riser). Die Vorlagen erzeugen normale, editierbare Keyframes. | B/C |
| 4 | Einzelne Layer eines Abschnitts an/aus, Pegel/Pan von dort, Beat aufbauen ohne neue Abschnitte | **Layer-Overrides pro Clip** (An/Aus, Pegel, Pan) im Clip-Inspektor. Ein Clip lässt sich zerteilen, und die Teile laufen **nahtlos** weiter (gleicher Player), nur mit anderen Layern. Später: Clip aufklappen → **Layer-Lanes** mit An/Aus-Balken und Pegel-/Pan-Keyframes. | B/C |
| 5 | Abschnitte untereinander legen, um sie zu kombinieren | Beliebig viele Abschnitts-Spuren übereinander. Jeder gleichzeitig klingende Clip bekommt einen eigenen `SectionPlayer` (TechnoEngine ohne eigenen Master-Bus). Alle laufen im Song-Tempo und bleiben synchron. | B |
| 6 | Aufnahmen machen, eigene Sounds (Gesang …) als Audio-Spur bearbeiten (Effekte, Schneiden) | **Audio-Spuren** mit Audio-Clips (nicht-destruktiv: schneiden, trimmen, verschieben, Fades, Clip-Gain, umkehren). Gleiche Effekt-Karten und Keyframes wie bei Abschnitts-Spuren. Aufnahme über Mikrofon/Interface mit Vorzähler, Metronom und Latenz-Ausgleich. Import von Dateien vom PC. | D/E |
| 7 | Snapping auf Beats usw. | Magnet-Raster (Aus · Takt · Beat · 1/8 · 1/16 · 1/32 · Triolen) und Einrasten an Clip-Kanten, Playhead und Markern. **Alt** schaltet es kurz ab. Gilt für Clips, Schnitte, Fades und Keyframes. | B |
| 8 | Abschnitte mit unterschiedlichen Kadenzen | **Gibt es schon:** Jeder Abschnitt speichert einen vollständigen `BeatSnapshot` inklusive `harmony` (Tonart, Kadenz, Baukasten). In der Timeline spielt jeder Clip die Kadenz seines Abschnitts. Neu: optional **Transponieren pro Clip**. | B |
| 9 | Eigene Sounds (aufgenommen oder vom PC) als Instrument in beiden Workspaces | Neue Voice **„Sample-Instrument“** (`sample-player`) mit den Modi Einzelschlag, Tonhöhe folgt Harmonie, Bass und Slices. Ein gemeinsamer **Audio-Pool** pro Projekt dient beiden Workspaces. Dazu ein Sample-Editor (Start/Ende/Loop, Grundton-Erkennung, Slices). | F |
| 10 | Klassische Akkorde: Neapolitaner, Sixte ajoutée u. ä. | Neue Akkordtypen für die übermäßigen Sextakkorde (it., fr., dt.) und **Funktions-Vorlagen**: Neapolitaner (N⁶), Sixte ajoutée (S⁶), übermäßige Sextakkorde, Doppeldominante, Zwischendominanten, Picardische Terz, Moll-Subdominante, vii°⁷, chromatische Medianten. Dazu neue klassische Kadenzen. | A |

> Hinweis zu Nr. 10: Mit „sixt ajutee“ ist wahrscheinlich die **Sixte ajoutée** (Subdominante mit hinzugefügter Sexte) gemeint. Weil die **übermäßigen Sextakkorde** (franz. *sixte augmentée*) im gleichen Atemzug genannt werden, kommen beide Familien hinein.

---

## 1. Bestandsaufnahme: worauf wir aufbauen

- **Abschnitte** (`SectionItem` in `src/core/state/types.ts`) enthalten einen vollständigen `BeatSnapshot` (Tempo, Taktart, Harmonie, Kurven, Layer). Sie eignen sich direkt als Clip-Quelle.
- **`renderSongChain`** (`src/core/engine/OfflineRenderer.ts`) spielt Abschnitte schon nacheinander mit *einer* Engine ab. Das ist der Vorläufer der Timeline. Er bleibt erhalten und bekommt den Knopf „Song-Kette → Timeline übernehmen“.
- **`TechnoEngine`** hat einen Snapshot-Crossfade von 15 ms. Stummgeschaltete Layer blenden weich aus und laufen zeitlich weiter (`LayerEngine.ts` ~Z. 586–600). Das ist die Grundlage für knackfreies Layer-An/Aus.
- **Klang-Karten** (`card-tone-filter`, `card-warmth-wavefold`, `card-body-sand`, `card-eq-orbit`, `card-tempo-echo`, `card-ducking-hall`) sind über `ProcessorInstance` generisch. Sie lassen sich ohne Umbau als Spur- und Master-Effekte verwenden. Sie brauchen nur einen `ProcessorContext` mit neutraler Harmonie.
- **`MasterBus`** (Sub-Mono, Glue, Limiter) wird im Timeline-Modus genau einmal am Ende verwendet.
- Das **Akkordsystem** (`theory/harmony.ts`, `theory/progression.ts`) baut Schritte aus Stufe, Vorzeichen, Akkordtyp und Bass-Spalte (`bass: root/third/fifth/seventh/degree/none`). Der Neapolitaner ist damit schon heute *baubar* (♭II, Dur, Bass = Terz), nur nicht als Vorlage.
- **Speicher:** IndexedDB (`DB_VERSION = 2`, Stores: projects, exports, curves, settings) und ein Projektordner über die File System Access API (`project.json`, `history.json`, `curves/`, `exports/`).
- **Worklet:** ein Prozessor (`techno-wave-processor`) mit den Nachrichten `snapshot | queue-section | play | stop | reset`.
- `useStudioStore.ts` hat schon 1600 Zeilen. Die Timeline bekommt deshalb einen **eigenen Store** und bläht ihn nicht weiter auf.

---

## 2. Architektur-Entscheidungen

1. **Ein Projekt, zwei Workspaces.** `ProjectDocument` bekommt `arrangement?: ArrangementDoc` und `assets?: AudioAssetMeta[]`. Der Worklet-Prozessor bekommt einen Modus `'beat' | 'arrangement'`. Es läuft immer nur einer, und beim Umschalten stoppt die Wiedergabe.
2. **Zeitbasis = Beats im Song-Tempo.** Eine `TempoMap` aus Tempo-Markern (zunächst Stufen, Rampen erst später) und Taktart-Markern rechnet zwischen Beat, Sekunde und Sample. Abschnitte spielen im Song-Tempo, ihr eigenes Tempo wird ignoriert. Wenn ein Abschnitt mit abweichendem Tempo platziert wird, fragt die UI: „Abschnitt hat 150 BPM, Song läuft mit 130 BPM. Ab hier Song-Tempo auf 150 setzen?“ Bei Ja entsteht ein Tempo-Marker.
   - Die **Taktart eines Abschnitts** bleibt intern erhalten. Ein 5/4-Abschnitt in einem 4/4-Song ergibt also Polymetrik. Clip-Längen werden in Beats gespeichert, das Raster folgt den Taktart-Markern des Songs.
3. **Clips verweisen live auf Abschnitte** (`sectionId`). Was man im Beatkasten ändert, hört man sofort in der Timeline. „Als eigene Variante abkoppeln“ legt einen neuen Abschnitt an und hängt den Clip um.
4. **`ArrangementEngine` in reinem TypeScript** (`src/core/arrangement/`, ohne DOM). Live im Worklet und im Export-Worker läuft derselbe Code.
5. **Keyframes sind keine Modulation.** Eine eigene `AutomationLane` speichert absolute Werte in Song-Zeit und wiederholt sich nie. Ausgewertet wird im Control-Rate-Raster (32 Samples, wie im Rest der Engine), vorab in flache `Float64Array`s kompiliert, also ohne Allokation.
6. **Audiodaten nie im JSON.** Im Projekt stehen nur Metadaten. Die PCM-Daten liegen im **AssetStore**: IndexedDB-Store `audio-assets` und im Ordner `<Projekt>/audio/<id>_<name>.wav`. Beim Import wird auf 48 kHz umgerechnet, und Wellenform-Peaks werden vorberechnet.
7. **Bearbeitung als reine Funktionen** (`arrangement/edit.ts`: teilen, trimmen, verschieben, duplizieren, überblenden). Das hält Undo, Tests und UI einfach.
8. **Undo:** Die Timeline bekommt einen eigenen linearen Undo/Redo-Stapel mit ganzen Arrangement-Kopien (klein, weil ohne Audio). Strg+Z wirkt immer im aktiven Workspace. Der History-Baum des Beatkastens bleibt unverändert.
9. **Performance:** Jeder gleichzeitig klingende Abschnitts-Clip ist eine `TechnoEngine`-Instanz.
   - Pool mit Obergrenze (Startwert 4 gleichzeitig, live).
   - Option `dryOutput` (kein eigener MasterBus).
   - **„Einfrieren“** (Phase D6): Ein Clip wird offline zu Audio gerendert und über einen Hash von Snapshot, Overrides und Tempo gecacht.
10. **Sample-Instrument über eine schlanke Engine-Schnittstelle.** `TechnoEngine.setSampleBank(bank)`. `LayerEngine` übergibt der Voice-Instanz die Sample-Daten über die optionale Methode `attachSample(source | null)`. Die Voices kennen weder Speicher noch UI, das Registry-Prinzip bleibt erhalten.

### Signalfluss im Timeline-Modus

```text
Abschnitts-Spur   Clip A ─► SectionPlayer #1 (TechnoEngine dry, Overrides, Transpose) ─► Clip-Hüllkurve (Gain, Fades) ─┐
                  Clip B ─► SectionPlayer #2 …                                                                    ├─► Spur-Summe ─► Spur-FX (Karten + Keyframes) ─► Pegel/Pan/Mute/Solo ─┐
Audio-Spur        Clip C ─► AudioClipReader (Offset, Gain, Fades, rückwärts) ────────────────────────────────────┘                                                                       │
                                                                                                                                                                                    ├─► Master-FX (+ Keyframes) ─► MasterBus ─► Ausgang
Metronom (nur bei Aufnahme/auf Wunsch) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Mikrofon ─► RecorderProcessor (2. Worklet-Knoten) ─► Pakete an UI ─► AssetStore ─► Audio-Clip
```

---

## 3. Datenmodell (Skizze)

```ts
// src/core/arrangement/types.ts
export interface TempoMarker { readonly id: string; readonly beat: number; readonly bpm: number }
export interface MeterMarker { readonly id: string; readonly beat: number; readonly numerator: number; readonly denominator: number } // nur auf Taktgrenzen
export interface SongMarker  { readonly id: string; readonly beat: number; readonly name: string; readonly color: string } // „Intro“, „Drop“ …

export type FadeShape = 'linear' | 'equal-power' | 'exp' | 's-curve';
export interface FadeConfig { readonly beats: number; readonly shape: FadeShape }

export interface LayerOverride { readonly enabled?: boolean; readonly level?: number; readonly pan?: number }

interface ClipBase {
  readonly id: string;
  readonly startBeat: number;
  readonly lengthBeats: number;
  readonly gain: number;            // 0..2
  readonly fadeIn: FadeConfig;
  readonly fadeOut: FadeConfig;
  readonly muted?: boolean;
}
export interface SectionClip extends ClipBase {
  readonly kind: 'section';
  readonly sectionId: string;
  readonly sourceOffsetBeats: number;   // ab welchem Beat des Abschnitts-Loops
  readonly layerOverrides: Readonly<Record<string, LayerOverride>>; // key = layerId
  readonly transposeSemitones?: number; // -12..+12
  readonly tailBeats?: number;          // Phase C5: Hall/Echo ausklingen lassen
}
export interface AudioClip extends ClipBase {
  readonly kind: 'audio';
  readonly assetId: string;
  readonly sourceOffsetSec: number;
  readonly reversed?: boolean;
  // Länge im Audio = Dauer von lengthBeats laut TempoMap (kein Time-Stretch)
}
export type ArrangementClip = SectionClip | AudioClip;

export interface ArrangementTrack {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly kind: 'section' | 'audio';
  readonly muted: boolean;
  readonly solo: boolean;
  readonly level: number;
  readonly pan: number;
  readonly fx: readonly ProcessorCardConfig[]; // wiederverwendet aus state/types.ts
  readonly clips: readonly ArrangementClip[];
  readonly armed?: boolean;                    // Aufnahme scharf (nur audio)
  readonly heightPx?: number;                  // UI
}

export type KeyframeCurve = 'linear' | 'smooth' | 'hold' | 'exp';
export interface Keyframe { readonly beat: number; readonly value: number; readonly curve: KeyframeCurve }

export type AutomationTarget =
  | { readonly scope: 'master'; readonly param: 'gain' | 'glue' }
  | { readonly scope: 'master-fx'; readonly cardId: string; readonly paramId: string }
  | { readonly scope: 'track'; readonly trackId: string; readonly param: 'level' | 'pan' }
  | { readonly scope: 'track-fx'; readonly trackId: string; readonly cardId: string; readonly paramId: string }
  // Beats relativ zum Clip-Start → wandert mit, wenn der Clip verschoben wird:
  | { readonly scope: 'clip-layer'; readonly clipId: string; readonly layerId: string; readonly param: 'level' | 'pan' | 'enabled' }
  // Phase C (Ausbau): beliebige modulierbare Regler eines Layers im Clip (z. B. Bass-Filter über 16 Takte öffnen)
  | { readonly scope: 'clip-layer-param'; readonly clipId: string; readonly layerId: string;
      readonly domain: 'voice' | 'processor'; readonly cardId: string; readonly paramId: string };

export interface AutomationLane {
  readonly id: string;
  readonly target: AutomationTarget;
  readonly enabled: boolean;
  readonly points: readonly Keyframe[];  // sortiert nach beat
  readonly generatedBy?: string;         // Übergangs-Vorlage, als Gruppe entfernbar
}

export interface ArrangementDoc {
  readonly version: 1;
  readonly tempoMarkers: readonly TempoMarker[];   // erster immer bei beat 0
  readonly meterMarkers: readonly MeterMarker[];   // erster immer bei beat 0
  readonly songMarkers: readonly SongMarker[];
  readonly tracks: readonly ArrangementTrack[];
  readonly masterFx: readonly ProcessorCardConfig[];
  readonly masterGain: number;
  readonly masterGlue: number;
  readonly automation: readonly AutomationLane[];
  readonly loop?: { readonly enabled: boolean; readonly startBeat: number; readonly endBeat: number };
  readonly snap: { readonly enabled: boolean; readonly grid: SnapGrid };
}

// src/core/audio/types.ts
export interface AudioAssetMeta {
  readonly id: string;
  readonly name: string;
  readonly source: 'recording' | 'import' | 'bounce' | 'freeze';
  readonly sampleRate: number;     // immer Projekt-Rate (48000) nach Import
  readonly channels: 1 | 2;
  readonly lengthSamples: number;
  readonly fileName: string;       // audio/<id>_<name>.wav
  readonly rootMidi?: number;      // erkannter/gesetzter Grundton (Sample-Instrument)
  readonly createdAt: number;
}

// Erweiterung state/types.ts (Phase F)
export interface LayerSampleConfig {
  readonly assetId: string;
  readonly rootMidi: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly loop?: { readonly startSec: number; readonly endSec: number; readonly crossfadeSec: number };
  readonly slices?: readonly number[];  // Slice-Startpunkte in Sekunden
}
// LayerConfig.sample?: LayerSampleConfig
// ProjectDocument.arrangement?: ArrangementDoc, ProjectDocument.assets?: AudioAssetMeta[]
```

**Migration:** Alte Projekte haben weder `arrangement` noch `assets`. Beim ersten Öffnen der Timeline entsteht ein leeres Arrangement mit Song-Tempo und Taktart des aktiven Snapshots. Das Angebot „Aus Song-Kette erzeugen“ legt die Abschnitte mit ihren `exportBars` hintereinander auf eine Spur. `ProjectDocument.version` wird erhöht, die Migration liegt in `state/arrangementMigration.ts`.

### Neue Dateien (Überblick)

```text
src/core/arrangement/  types.ts · tempoMap.ts · snap.ts · edit.ts · clipSnapshot.ts · scheduler.ts
                       SectionPlayer.ts · AudioClipReader.ts · TrackBus.ts · automation.ts
                       transitions.ts · ArrangementEngine.ts · renderArrangement.ts
src/core/audio/        types.ts · SampleBank.ts · resample.ts · peaks.ts · wavDecoder.ts
                       pitchDetect.ts · transients.ts
src/core/theory/       classicalChords.ts
src/core/timbre/voices/SamplePlayerVoice.ts
src/core/timbre/processors/TapeStopCard.ts (Phase C)
src/core/state/        arrangementMigration.ts
src/audio-host/        RecorderProcessor.ts · recorder.ts · assetTransfer.ts
src/storage/           AssetStore-Methoden in IndexedDbAdapter + BrowserFsAdapter
src/ui/timeline/       TimelineWorkspace.tsx · TimelineRuler.tsx · TrackHeader.tsx · TrackLane.tsx
                       ClipView.tsx · AutomationLaneView.tsx · ClipInspector.tsx · TrackInspector.tsx
                       MediaBrowser.tsx · TransitionPalette.tsx · useArrangementStore.ts · geometry.ts
src/ui/components/     SampleEditor.tsx · WaveformCanvas.tsx · RecordControls.tsx · WorkspaceSwitch.tsx
```

---

## 4. Phasen & Arbeitspakete

### Phase A — Klassische Akkorde (schneller Gewinn, unabhängig vom Rest)

**A1 Akkordtypen** (`theory/harmony.ts`), neue Kategorie `classical` („Klassisch & Funktional“):

| ID | Name | Intervalle vom Akkord-Grundton | Beispiel (Grundton auf ♭VI von C) |
|---|---|---|---|
| `it6` | Italienischer Sextakkord (übermäßiger Sextakkord) | `[0, 4, 10]` | As – C – Fis |
| `fr6` | Französischer Sextakkord (übermäßiger Terzquartakkord) | `[0, 4, 6, 10]` | As – C – D – Fis |
| `ger6` | Deutscher Sextakkord (übermäßiger Quintsextakkord) | `[0, 4, 7, 10]` | As – C – Es – Fis |

Klanglich ist `ger6` gleich `dom7` (enharmonisch). Er bekommt trotzdem einen eigenen Typ, damit Name, Funktionssymbol und Stimmführung (Auflösung auswärts zur Dominante) stimmen.

**A2 Funktions-Vorlagen** (`theory/classicalChords.ts`): `resolveClassicalTemplate(id, scaleId) → Partial<ChordStepConfig>`. Die Vorlage rechnet Stufe und Vorzeichen passend zur aktuellen Skala aus. Dafür kommt die Hilfsfunktion `pcToDegreeAccidental(scale, pc)` hinzu.

| Vorlage | Funktion | Bauweise | in a-Moll | in C-Dur |
|---|---|---|---|---|
| Neapolitaner | N⁶ / sN | ♭II, Dur, Bass = Terz | B/D | Des/F |
| Sixte ajoutée | S⁶ / s⁶ | IV mit Sexte (`major6` bzw. `minor6`) | Dm6 | F6 |
| Italienischer ⁺⁶ | | ♭VI, `it6`, Bass = Grundton | F – A – Dis | As – C – Fis |
| Französischer ⁺⁶ | | ♭VI, `fr6` | F – A – H – Dis | As – C – D – Fis |
| Deutscher ⁺⁶ | | ♭VI, `ger6` | F – A – C – Dis | As – C – Es – Fis |
| Doppeldominante | DD⁷ (V⁷/V) | II, `dom7` | H7 | D7 |
| Zwischendominante | V⁷/x (x = ii … vi) | Grundton = Stufe x + 7 HT, `dom7` | | |
| Picardische Terz | Tᴾ | I, Dur (Schlussakkord in Moll) | A | |
| Moll-Subdominante | s (in Dur) | IV, Moll | | Fm |
| Verminderter Septakkord | vii°⁷ (D̸⁹) | VII (in Moll: ♯VII), `dim7` | Gis°7 | H°7 |
| Chromatische Mediante | ♭III / ♭VI (Dur) | Dur-Akkorde | | Es, As |

- `ChordStepConfig.templateId?` (optional) speichert die Herkunft. Der Baukasten zeigt dann das Funktionssymbol („N⁶“, „Dt⁺⁶“) neben dem Akkordnamen.
- `ProgressionStepDef` bekommt `template?` und `bass?`, damit auch Kadenz-Vorlagen diese Akkorde nutzen können.

**A3 Neue Kadenzen** (Gruppe `classical`, „Klassische Kadenzen“):

| Kadenz | Folge |
|---|---|
| Neapolitanische Kadenz | i – N⁶ – V⁷ – i |
| Kadenz mit Sixte ajoutée | I – S⁶ – D⁷ – T |
| Deutsche Sexte | i – Dt⁺⁶ – V – i |
| Italienische Sexte | i – It⁺⁶ – V – i |
| Französische Sexte | i – Fr⁺⁶ – V – i |
| Doppeldominante | I – DD⁷ – V⁷ – I |
| Picardie-Schluss | i – iv – V⁷ – I |
| Romantische Moll-Subdominante | I – iv – I |

**A4 Stimmführung:** Bei den übermäßigen Sexten liegt ♭6 im Bass, ♯4 in einer Oberstimme. `voiceLeading.ts` prüfen. Test: Dt⁺⁶ → V, die beiden Außenstimmen gehen je einen Halbton auseinander zur Oktave.

**A5 UI:**
- `HarmonyBuilderPanel.tsx`: Chip-Gruppe „Klassisch“ mit den Vorlagen. Ein Klick setzt den markierten Schritt bzw. fügt einen neuen ein. Ein Tooltip erklärt die Funktion in einem Satz.
- Die Akkordtyp-Auswahl bekommt die Kategorie „Klassisch“.
- `TransportBar.tsx`: Gruppe „Klassische Kadenzen“.

**A6 Tests:** Intervalle, Auflösung in a-Moll und C-Dur (Werte aus der Tabelle oben), Kadenz-Timelines, alte Projekte unverändert.

### Phase B — Timeline-Kern

**B1 Datenmodell, Migration, Speichern**
- Typen aus Abschnitt 3 anlegen, `arrangementMigration.ts` schreiben.
- `BrowserFsAdapter`: eigene Datei `arrangement.json` im Projektordner. `IndexedDbAdapter`: im Dokument.
- `useArrangementStore.ts` mit Undo/Redo (linear, max. 200 Schritte) und Autosave wie im Beatkasten.

**B2 TempoMap & Snapping** (`tempoMap.ts`, `snap.ts`)
- `beatToSec`, `secToBeat`, `beatToSample`, Takt/Beat-Zählung mit Taktart-Markern, `barStartBeat(n)`.
- `snapBeat(beat, grid, tempoMap)` für Aus · Takt · Beat · 1/2 · 1/4 · 1/8 · 1/16 · 1/32 · Triolen.
- Einrasten an Kandidaten (Clip-Kanten, Playhead, Marker) mit Pixel-Toleranz. Das macht die UI.
- Tests mit Tempo- und Taktartwechseln.

**B3 Erweiterungen der `TechnoEngine`**
- Konstruktor-Option `{ dryOutput: true }` → kein MasterBus, nur die Layer-Summe.
- `setTempoBpm(bpm)` ohne Phasensprung (Tempo-Marker mitten im Clip).
- `deriveClipSnapshot(section.snapshot, clip, songBpm, meter)` (`clipSnapshot.ts`, reine Funktion) setzt Song-Tempo, Transponierung (`harmony.rootNote + n`) und Layer-Overrides (`enabled`, `level`, `pan`) in eine Kopie des Snapshots.
- **Prüfen und testen:** `applySnapshot` ohne Strukturwechsel darf Takt-Phase, Hall und Echo nicht zurücksetzen. Das ist Voraussetzung für nahtloses Zerteilen.

**B4 `ArrangementEngine`**
- `scheduler.ts`: Clips pro Spur sortiert, Cursor-basiert. Clip-Grenzen fallen sample-genau, weil Blöcke an Clip-Grenzen geteilt werden, so wie heute an Akkordgrenzen.
- `SectionPlayer` aus dem Pool:
  - Beim Clip-Start: `applySnapshot(derived)` und `seekToBeat(sourceOffset)`.
  - Je Block die Synchronisation prüfen (erwarteter lokaler Beat = Song-Beat − Start + Offset) und korrigieren, wenn sie mehr als 1 Sample abweicht.
- **Nahtlos:** Wenn der Folge-Clip auf derselben Spur denselben Abschnitt nutzt und sein Offset genau anschließt, wird der Player weiterverwendet. Es kommt nur ein neuer abgeleiteter Snapshot. Sonst startet ein neuer Player mit dem Fade des Clips.
- Clip-Hüllkurve: Gain, Fade-In/-Out in den 4 Formen, Überlappung auf derselben Spur ergibt Equal-Power-Überblendung.
- `TrackBus`: Summe, FX-Karten (Instanzen aus der Registry, `ProcessorContext` mit der Harmonie des ersten aktiven Clips oder neutral), Pegel/Pan, Mute/Solo (wie Layer-Solo).
- Master-FX, `MasterBus` (masterGain/masterGlue des Arrangements). Der `masterGain` eines Abschnitts wirkt als Vor-Gain seines Clips.
- Seek/Locate: alle Player zurücksetzen und den Scheduler neu aufbauen. Loop-Bereich.
- Telemetrie: Song-Beat, Peak je Spur, aktive Clip-IDs.

**B5 Worklet & Bridge**
- Neue Nachrichten: `set-mode`, `arrangement` (ganzes Dokument, entprellt), `sections` (Map `id → snapshot`, bei Änderungen im Beatkasten), `seek`, später `asset-add/remove`.
- Telemetrie `songBeat` und `trackPeaks`.
- `AudioBridge` bekommt `setMode`, `loadArrangement`, `seekSongBeat`.

**B6 Timeline-UI** (`src/ui/timeline/`)
- **Workspace-Umschalter** (Tabs „Beatkasten | Timeline“) in der `TransportBar`. Play/Stop, Position (Takt:Beat), Song-Tempo und Taktart teilen sich die Leiste.
- **Layout** (wiederverwendeter `Splitter`):
  - links: *Medien-Browser* (Abschnitte des Projekts, später Audio-Pool), per Drag in die Timeline ziehen
  - Mitte: *Lineal* (Takte, Song-Marker, Loop-Bereich, Zeile für Tempo- und Taktart-Marker) und *Spuren* (Kopf + Clip-Fläche)
  - unten: *Inspektor* (Clip oder Spur)
- **Darstellung:** Clips als absolut positionierte DOM-Elemente, nur im sichtbaren Bereich gerendert. Lineal, Raster, Wellenformen und Keyframes als Canvas. Zoom mit Strg+Mausrad, Playhead folgt optional.
- **Werkzeuge:** Auswahl (V), Schere (C), später Keyframe-Stift (B).
- **Tastatur:**
  - Leertaste = Play/Stop
  - S = am Playhead teilen
  - Entf = löschen
  - Strg+D = duplizieren
  - Strg+C/V = kopieren/einfügen
  - Pfeiltasten = um eine Rasterweite verschieben
  - Shift = Mehrfachauswahl, Rahmen-Auswahl mit der Maus
  - Alt = Snapping kurz aus
- **Abschnitts-Clip:**
  - Farbe und Name des Abschnitts, schmale Mini-Streifen für die aktiven Layer.
  - Rechte Kante ziehen = verlängern, der Loop läuft weiter. Linke Kante = Offset verschieben.
  - Fade-Anfasser oben links/rechts.
- **Clip-Inspektor:**
  - Layer-Liste mit An/Aus, Pegel, Pan; „auf Abschnitt zurücksetzen“
  - Clip-Gain, Fades (Länge, Form), Transponieren
  - „Im Beatkasten öffnen“ (wechselt den Workspace und aktiviert den Abschnitt)
  - „Als Variante abkoppeln“
- **Spur-Kopf:** Name, Farbe, Mute/Solo, Pegel, Pan, FX-Knopf (öffnet den Spur-Inspektor mit der Karten-Kette, gleiche Drag-&-Drop-Komponente wie im Beatkasten), Spur-Meter.
- **Hinweise im UI:**
  - Liegen Clips mit verschiedenen Tonarten übereinander, erscheint ein dezenter Hinweis.
  - Ein fehlender Abschnitt zeigt „Abschnitt fehlt“ und bleibt stumm.
  - Wer einen Abschnitt löscht, der in der Timeline benutzt wird, bekommt vorher eine Rückfrage.

**B7 Export:** `renderArrangement()` im `ExportWorker` (WAV/MP3; ganzer Song oder Loop-Bereich; optional Stems pro Spur). Der Export-Dialog bekommt den Reiter „Timeline“. Der Knopf „Song-Kette → Timeline übernehmen“ kommt dazu.

**B8 Tests:**
- TempoMap und Snap
- Scheduler: Clip-Grenzen sample-genau
- **Zerteilter Clip klingt bit-identisch wie der ungeteilte**
- Layer-Overrides
- Renderlänge bei Tempowechseln
- Migration und Export-Länge
- Performance: 3 parallele Abschnitte à 4 Layer, 10 s, im Budget

### Phase C — Effekte, Keyframes & Übergänge

**C1 Automation-Kern** (`automation.ts`)
- Kurvenformen: linear, weich (monotone kubische Interpolation, kein Überschwingen), halten (Stufe), exponentiell (für Frequenz-artige Regler).
- Auswertung je 32-Sample-Block mit Cursor. Werte werden auf `[min, max]` des `ParameterSchema` begrenzt.
- Fehlt der Keyframe vor dem ersten Punkt, gilt der erste Wert. Nach dem letzten Punkt gilt der letzte.

**C2 Ziele:**
- Master (Gain, Glue)
- Spur (Pegel, Pan)
- alle modulierbaren Regler der Spur- und Master-FX-Karten (über die Registry)
- Clip-Layer (Pegel, Pan, An/Aus als Stufe)
- im Ausbau `clip-layer-param`: jeder modulierbare Regler eines Layers im Clip, z. B. „Bass-Filter über 16 Takte öffnen“. Technik: neuer Modulations-Quelltyp `external` im `ModulationRouter` mit Slot-Index. Die `ArrangementEngine` schreibt die Keyframe-Werte pro Block in ein vorab angelegtes `Float32Array`.

**C3 UI:**
- Unter jeder Spur lassen sich Automationsspuren aufklappen („+ Automation“ → Ziel aus Menü in Musiker-Sprache, Labels und Einheiten aus dem `ParameterSchema`).
- Keyframe-Stift:
  - Klick = Punkt setzen
  - Ziehen = verschieben (mit Snapping)
  - Doppelklick = löschen
  - Rechtsklick = Kurvenform
  - Rahmen-Auswahl, Kopieren/Einfügen
- **Clip aufklappen → Layer-Lanes:** An/Aus-Balken malen (Kick ab Takt 17) und Pegel-/Pan-Keyframes. Das ist der Workflow „Beat aufbauen ohne neue Abschnitte“.

**C4 Übergangs-Vorlagen** (`transitions.ts`, `TransitionPalette.tsx`): auf eine Clip-Grenze ziehen oder per Rechtsklick auf die Grenze → Länge in Takten wählen.

| Vorlage | Was passiert |
|---|---|
| Überblenden | Clips überlappen, Equal-Power-Fades |
| Ein-/Ausblenden | Fade am Clip-Anfang bzw. -Ende |
| Filter-Fahrt runter/rauf | Tiefpass-Keyframes auf der Spur-Karte „Ton & Filter“ (wird bei Bedarf eingefügt) |
| Hochpass-Aufbau | Hochpass steigt vor dem Drop, beim Drop schlagartig zurück |
| Echo-Ausklang | Echo-Feedback hoch, Signal davor wird ausgeblendet |
| Hall-Wash | Hall-Anteil schwillt an und klingt aus |
| Break | ½ Takt bzw. 1 Beat Stille vor dem Ziel-Clip |
| Bremse (Tape-Stop) | neue Karte `card-tape-stop` (Ringpuffer mit fallender Lese-Geschwindigkeit) |
| Riser | fügt einen automatisch erzeugten kurzen Riser-Clip ein (Mini-Abschnitt mit `noise-riser`-Voice) |

Vorlagen erzeugen nur normale Keyframes oder Clips mit `generatedBy`. Man kann sie danach frei bearbeiten oder als Gruppe entfernen.

**C5 Clip-Ausklang („Hall & Echo ausklingen lassen“):** Am Clip-Ende werden die Stimmen stumm, die Karten-Kette läuft `tailBeats` weiter. Dafür braucht `LayerEngine` ein Flag `voicesSilenced` (Voice-Ausgang 0, Prozessor-Kette läuft weiter).

**C6 Neue Karten** (in derselben Registry, also auch im Beatkasten nutzbar): `card-tape-stop` (Bremse), `card-beat-repeat` (Stotter/Wiederholen), `card-evenness` („Gleichmäßig machen“ = Kompressor, wichtig für Gesang).

### Phase D — Audio-Spuren: Import & Bearbeitung

**D1 AssetStore**
- IndexedDB: `DB_VERSION 3`, neuer Store `audio-assets` (ArrayBuffer je Asset).
- Projektordner: `audio/<id>_<name>.wav`. Dafür kommt ein 32-Bit-Float-Schreiber dazu (`wavEncoder` erweitern) und ein `wavDecoder`.
- Adapter-Interface: `saveAsset`, `loadAsset`, `deleteAsset`, `listAssets`.
- PCM wird verzögert geladen, beim Öffnen nur die Metadaten.
- „Nicht verwendete Aufnahmen aufräumen“ (Assets ohne Referenz).

**D2 Import**
- Dateiauswahl und Drag & Drop in den Medien-Browser bzw. direkt auf eine Spur. WAV/MP3/OGG/FLAC/M4A über `decodeAudioData`.
- Umrechnung auf 48 kHz (`OfflineAudioContext` oder `resample.ts`).
- Normalisieren optional. Peaks (Min/Max in mehreren Zoomstufen) im Worker berechnen und cachen.

**D3 `AudioClipReader`:** Offset, Gain, Fades, rückwärts. Die Startposition liegt in Beats, der Inhalt in Sekunden. Bei Tempoänderungen wandert der Start mit, das Audio wird **nicht** gestreckt (Time-Stretch → Phase G).

**D4 Transfer ins Worklet**
- `assetTransfer.ts`: Kopie des `Float32Array` je Kanal per `postMessage` (transferable). Der Export-Worker bekommt die Assets ebenfalls.
- `SharedArrayBuffer` (dafür nötig: COOP/COEP-Header in `vite.config.ts`) erst später als Speicher-Optimierung.

**D5 Bearbeitung** (nicht-destruktiv über `edit.ts`)
- Schneiden (Schere / S), Kanten trimmen, verschieben, duplizieren, Fades, Clip-Gain (Ziehen am Clip-Kopf), umkehren, normalisieren (als Gain-Wert).
- „Auswahl zu neuem Audio zusammenfügen“ (Bounce, erzeugt ein neues Asset).
- Spur-Effekte und Keyframes funktionieren wie bei Abschnitts-Spuren, z. B. Gesang mit Hall, Echo, Filter, EQ, Wärme, Gleichmäßig.

**D6 Einfrieren:** Abschnitts-Clip oder ganze Spur → offline rendern → Asset (`source: 'freeze'`), gecacht über einen Hash von Snapshot, Overrides, Tempo und Länge. Der Clip spielt dann als Audio ab und entlastet die CPU. „Auftauen“ macht ihn wieder lebendig.

### Phase E — Aufnahme

**E1 Recorder**
- `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })` → `MediaStreamAudioSourceNode` → eigener Worklet-Knoten `RecorderProcessor.ts`.
- Der Knoten sammelt Blöcke und schickt Pakete (transferable) an den Main-Thread.
- Geräteauswahl (`enumerateDevices`), Mono (Standard) oder Stereo, Eingangspegel-Anzeige.

**E2 Ablauf**
- Spur scharf schalten → Aufnahme-Knopf → Vorzähler (0/1/2 Takte) mit Metronom-Klick (in der `ArrangementEngine` synthetisiert, auf Wunsch auch während der Aufnahme).
- Die Aufnahme startet ab Playhead bzw. Loop-Start.
- Nach dem Stopp: Daten zusammenfügen → Asset → Audio-Clip an der richtigen Stelle.
- Loop-Aufnahme erzeugt mehrere Takes als übereinanderliegende Clips (Take-Auswahl später).

**E3 Latenz-Ausgleich**
- Automatisch aus `ctx.baseLatency + ctx.outputLatency` plus geschätzter Eingangslatenz.
- Dazu manueller Feinversatz in ms (in den Einstellungen gespeichert).
- Optionale **Kalibrierung:** Klick abspielen, über das Mikrofon aufnehmen, Versatz per Kreuzkorrelation messen.

**E4 Mithören:** Standardmäßig aus, Hinweis „Kopfhörer benutzen“. Optional direktes Mithören, mit Warnung wegen Latenz.

**E5 Kurz-Aufnahme fürs Sample-Instrument:** derselbe Recorder, aufrufbar aus dem Sample-Editor (Phase F). Stille am Anfang und Ende wird automatisch abgeschnitten.

### Phase F — Sample-Instrument (beide Workspaces)

**F1 Voice `sample-player` „Sample-Instrument“**, Modus-Regler:
- **Einzelschlag:** Drum-Hit, Tonhöhe fest, Rhythmus-Raster triggert.
- **Tonhöhe folgt Harmonie:** chromatisch über `rootMidi`; Akkord-/Melodie-Töne wie bei den anderen Harmonie-Instrumenten, fester Ton über `LayerConfig.pitch`.
- **Bass:** folgt `bassMidi`. Dafür bekommt `LayerEngine` einen kleinen generischen Haken `voice.isBassFor?(params)`, weil die Kategorie sonst statisch ist.
- **Slices:** Step-Index bzw. Zufall wählt das Stück.

**F2 Engine-Haken:** `SampleBank` (Map `assetId → { left, right, sampleRate, length }`) über `TechnoEngine.setSampleBank()`. `LayerEngine` ruft beim Wechsel von `LayerConfig.sample.assetId` die Methode `instance.attachSample(source | null)` auf. Der Beatkasten-Modus, der Timeline-Modus und der Export-Worker nutzen dieselbe Bank.

**F3 DSP**
- 8 Stimmen, Hermite-Interpolation, Tonhöhe = 2^((Note − Grundton)/12).
- Regler, gruppiert nach `paramLayout.ts`: Start, Ende, Anschlag, Halten (Gate/Sustain wie die anderen Anschlag-Instrumente), Ausklang, Stimmung (Halbtöne/Cent), Helligkeit (SVF), rückwärts, Loop an/aus, Slice-Anzahl, Akzent → Lautstärke.
- Alles modulierbar. Ein Startpunkt, der sich mit einer Welle bewegt, ergibt eine granular-artige Textur.

**F4 Sample-Editor** (`SampleEditor.tsx`)
- Wellenform, Marker für Start, Ende und Loop zum Ziehen.
- Grundton per automatischer Tonhöhen-Erkennung (YIN, `pitchDetect.ts`) oder manuell.
- Normalisieren, Stille abschneiden, Slices automatisch an Transienten (`transients.ts`), Vorhören.
- **Quellen:** Audio-Pool, „Neu aufnehmen“, „Datei laden“, in der Timeline per Rechtsklick auf einen Audio-Clip „Als Instrument verwenden“.

**F5 Gemeinsamer Audio-Pool:** im Medien-Browser der Timeline und in der Säule 2 des Beatkastens (Instrument „Sample-Instrument“ → „Sound wählen …“). Fehlt ein Asset, bleibt das Instrument stumm und zeigt einen Hinweis.

### Phase G — Später / optional (bewusst nicht im ersten Wurf)
- Tempo-Rampen (accelerando), Time-Stretch und Tonhöhenkorrektur für Audio
- Takes/Comping, Punch-In
- Spur-Sidechain (Kick-Spur duckt Bass-Spur)
- `SharedArrayBuffer` für große Projekte
- MIDI-Keyboard als Eingabe

---

## 5. Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| CPU-Last durch mehrere parallele Abschnitte | Pool-Limit mit sichtbarem Hinweis, `dryOutput`, Einfrieren (D6), nicht benötigte Player sofort freigeben, Performance-Test in B8 |
| Speicher bei langen Aufnahmen (10 min Stereo Float32 ≈ 230 MB) | Aufnahmen standardmäßig mono, PCM nur verzögert laden, unbenutzte Assets aus dem RAM werfen, auf der Platte als 24-Bit-WAV speichern (D1) |
| OneDrive-Projektordner synchronisiert große WAVs | Hinweis im Speichern-Dialog. Assets liegen in einem eigenen Unterordner `audio/`. |
| Gelöschte Abschnitte oder Layer, auf die ein Clip verweist | Override für einen unbekannten Layer wird ignoriert, fehlender Abschnitt = stummer Clip mit Hinweis, Rückfrage beim Löschen |
| Abschnitts-Snapshot mit eigenem Tempo und Master-Gain | Tempo durch das Song-Tempo ersetzt, Master-Gain wirkt als Clip-Vor-Gain, Glue nur auf dem Master |
| Knackser beim Layer-An/Aus und an Clip-Grenzen | vorhandener Mute-Fade (~15–20 ms), Fades sind Pflicht-Minimum (1 ms), nahtlose Player-Weiterverwendung |
| Browser-Grenzen | File System Access API und `getUserMedia` brauchen einen sicheren Kontext. `localhost` ist ok. Chrome/Edge als Zielbrowser, wie bisher. |

---

## 6. Checkliste

**Phase A — Klassische Akkorde**
- [x] A1 Akkordtypen `it6` / `fr6` / `ger6` und Kategorie `classical`
- [x] A2 `classicalChords.ts` mit Vorlagen und `pcToDegreeAccidental`; `templateId` in `ChordStepConfig`
- [x] A3 Klassische Kadenzen (`ProgressionStepDef.template/bass`)
- [x] A4 Stimmführung der übermäßigen Sexten prüfen und testen
- [x] A5 UI: Chips „Klassisch“ im Baukasten und Kadenz-Gruppe in der TransportBar
- [x] A6 Tests, `tsc`, `vitest`, `vite build`

**Phase B — Timeline-Kern**
- [x] B1 Datenmodell, Migration, `arrangement.json` und IndexedDB, `useArrangementStore` mit Undo
- [x] B2 TempoMap und Snapping mit Tests
- [x] B3 TechnoEngine: `dryOutput`, `setTempoBpm`, `deriveClipSnapshot`, Test „applySnapshot ohne Phasensprung“
- [x] B4 ArrangementEngine: Scheduler, SectionPlayer-Pool, nahtlose Fortsetzung, Fades/Überblendung, TrackBus, Master
- [x] B5 Worklet-Modus und Bridge-Nachrichten, Telemetrie
- [x] B6 Timeline-UI: Umschalter, Lineal, Spuren, Clips, Werkzeuge, Snapping, Clip- und Spur-Inspektor, Medien-Browser
- [x] B7 Export Timeline (WAV/MP3/Stems) und „Song-Kette → Timeline“
- [x] B8 Tests (inkl. bit-identischem Zerteilen und Performance), jsdom-UI-Smoke-Test
- [ ] B8b Browser-Check / Hörtest durch den Nutzer

**Phase C — Effekte, Keyframes & Übergänge**
- [x] C1 Automation-Kern (4 Kurvenformen, zero-alloc)
- [x] C2 Ziele Master / Spur / FX / Clip-Layer (Pegel, Pan, An/Aus)
- [x] C2b (Ausbau) `clip-layer-param` über die Modulations-Quelle `external`
- [x] C3 Automations-UI und Layer-Lanes im aufgeklappten Clip
- [x] C4 Übergangs-Vorlagen und Palette
- [x] C5 Clip-Ausklang (`voicesSilenced`)
- [x] C6 Karten Tape-Stop, Beat-Repeat, Gleichmäßig

**Phase D — Audio-Spuren**
- [x] D1 AssetStore (IndexedDB v3, Ordner `audio/`, Float-WAV-Schreiber und -Leser)
- [x] D2 Import (Datei, Drag & Drop), Resampling, Peaks
- [x] D3 AudioClipReader
- [x] D4 Asset-Transfer an Worklet und Export-Worker
- [x] D5 Schneiden, Trimmen, Fades, Gain, Umkehren, Bounce
- [x] D6 Einfrieren / Auftauen

**Phase E — Aufnahme**
- [x] E1 RecorderProcessor, Geräteauswahl, Pegel
- [x] E2 Aufnahme-Ablauf mit Vorzähler und Metronom, Takes
- [x] E3 Latenz-Ausgleich und Kalibrierung
- [x] E4 Mithören (optional)
- [x] E5 Kurz-Aufnahme für das Sample-Instrument

**Phase F — Sample-Instrument**
- [x] F1 Voice `sample-player` (4 Modi)
- [x] F2 SampleBank und `attachSample`-Haken
- [x] F3 DSP mit Reglern und Gruppen
- [x] F4 Sample-Editor (Marker, Grundton-Erkennung, Slices)
- [x] F5 Audio-Pool in beiden Workspaces

**Am Ende jeder Phase:** Tests, `tsc`, `vite build`, Browser-Check, Status in `implementation-status.md` nachtragen, Hörtest durch den Nutzer.

---

## 7. Aufteilung für `/delegate` (Vorschlag)

| Paket | Wer | Begründung |
|---|---|---|
| A1–A3 (Theorie und Daten), A6 Tests | `sonnet-worker` | klar spezifiziert, braucht aber musiktheoretische Sorgfalt |
| A4 Stimmführung, A5 UI-Feinschliff | Supervisor prüft, `sonnet-worker` setzt um | Korrektheit hörbar |
| B1, B2 (Typen, Migration, TempoMap, Snap und Tests) | `sonnet-worker` | reine Funktionen, gut testbar |
| B3, B4 (Engine-Kern, Scheduler, nahtloses Zerteilen) | **Supervisor selbst** bzw. eng geführter `sonnet-worker` | Architektur- und Echtzeit-kritisch |
| B5 Bridge-Nachrichten, Registrierungen, CSS, Labels | `haiku-worker` | mechanisch |
| B6 Timeline-UI | `sonnet-worker` in Teilpaketen (Lineal → Spuren/Clips → Werkzeuge → Inspektoren) | viel Code, aber genau beschreibbar |
| C1, C2 Automation-Kern | `sonnet-worker` | |
| C4 Übergangs-Vorlagen, C6 Karten | `sonnet-worker` | |
| D1–D4 Assets, Import, Transfer | `sonnet-worker` | |
| E1–E3 Recorder und Latenz | Supervisor und `sonnet-worker` | Browser-APIs, Timing-kritisch |
| F1–F4 Sample-Instrument und Editor | `sonnet-worker`; Supervisor prüft DSP | |


---

## 8. Umsetzungsnotizen (Stand 18.11.2026)

**Neue Dateien Phase A–C**
- `src/core/theory/classicalChords.ts` (Vorlagen, `pcToDegreeAccidental`, `resolveClassicalTemplate`), Akkordtypen `it6/fr6/ger6` in `harmony.ts`, Kadenz-Gruppe `classical`. `ChordStepConfig.templateId`: Vorlagen-Akkorde folgen der Skala; Bearbeiten von Stufe/Alteration/Farbe löst die Vorlage.
- `src/core/arrangement/`: `types`, `tempoMap`, `snap`, `edit` (inkl. Automation-Lanes), `clipSnapshot`, `automation` (LaneEvaluator), `FxChain`, `ArrangementEngine` (compile + render), `renderArrangement`, `transitions`.
- `src/core/state/arrangementMigration.ts`, `src/core/audio/types.ts`.
- Karten `card-tape-stop`, `card-beat-repeat`, `card-evenness` (registriert über `EXTRA_PROCESSOR_CARDS`, NICHT in der Standard-Layer-Kette).
- UI `src/ui/timeline/*`, `src/ui/components/WorkspaceSwitch.tsx`.

**Entscheidungen / Abweichungen**
- Ein `SectionPlayer` ist direkt eine `TechnoEngine` mit `{ dryOutput: true }`; Pool fest vorab angelegt (live 4, offline 16).
- Compile fasst nahtlose, gleich klingende Nachbar-Clips zu EINEM Segment zusammen → geteilter Clip ist bit-identisch (Test). Kette (= Player-Kontinuität) auch bei unterschiedlichen Overrides.
- `applySnapshot` behält die Beat-Position bei Tempo-Änderungen (kein Phasensprung, auch im Beatkasten).
- Layer-Override „Aus“ = `muted` (weicher Fade, Puls bleibt für Sidechains).
- Clip-Layer-Keyframes über `TechnoEngine.setLayerOverride` (pro Render-Chunk), Clip-Ausklang über `setVoicesSilenced` (5-ms-Gate in `LayerEngine`, Karten laufen weiter).
- Übergangs-Vorlagen fügen eine eigene Karte mit ID-Präfix `<runId>:` ein; `removeTransition` entfernt Karte, Lanes und Clips der Vorlage.
- Übergänge werden über die Palette „Übergang“ an der Clip-Grenze nahe der Startposition (gewählte Spur) angewendet (statt Drag auf die Grenze).
- Worklet hat Modus `beat | arrangement`; `AudioBridge.setMode/loadArrangement/setSections/playArrangement/seekSongBeat/setAsset`.
- Speichern: `arrangement.json` + `assets.json` im Projektordner; IndexedDB speichert das ganze Dokument.

**Tests**: `tests/unit/classical-chords.test.ts`, `tests/unit/arrangement-core.test.ts`, `tests/dsp/new-cards.test.ts`, `tests/ui/timeline-smoke.test.ts` (jsdom, mountet die App im Timeline-Modus).

**Phase D–F (Ergänzung)**
- Audio-Pool: `src/core/audio/{wavCodec,resample,peaks,analysis}.ts`, `src/audio-host/assetImport.ts`, `src/ui/audio/useAudioPool.ts`, `src/ui/timeline/useTimelineAudio.tsx`. PCM in IndexedDB (`audio-assets`, DB v3) und `<Projekt>/audio/<id>_<name>.wav` (32-Bit-Float statt 24-Bit, verlustfrei). Peaks werden im Main-Thread berechnet (nicht im Worker).
- Einfrieren: `SectionClip.frozenAssetId/frozenKey` (FNV-Hash in `clipSnapshot.freezeKeyForDoc`); veralteter Schlüssel → spielt automatisch wieder live. Render-Stufen `outputStage: 'raw-clips' | 'pre-master'` für Einfrieren / Bounce.
- Aufnahme: `RecorderProcessor.ts` (2. Worklet), `recorder.ts`, `RecordControls.tsx`. Sync über `play-started` (Audio-Frame) + Latenz (auto/gemessen + Feinversatz). Loop-Aufnahme = ein Asset, Takes als übereinanderliegende Clips (ältere stumm). Metronom in der `ArrangementEngine` (nach dem Limiter).
- Sample-Instrument: `SamplePlayerVoice.ts` (`sample-player`), Bass-Modus liest `harmony.bassMidi` direkt (kein `isBassFor`-Haken nötig). `VoiceInstance.attachSample`, `LayerEngine.sampleLookup/syncSamples`, `TechnoEngine.setSampleBank/refreshSamples`; Export übergibt den Pool (`ExportRequest.assets`). UI: `SampleEditor.tsx` (Marker, YIN-Grundton, Slices, Vorhören, Kurz-Aufnahme), Abschnitt in Säule 2, „Als Instrument verwenden“ an Audio-Clips.
- C2b: Modulations-Quelle `external` (`ModulationRouter.setExternalValue`), Ziel `clip-layer-param`; der Compile-Schritt injiziert die Route in den Clip-Snapshot, Wert = (Keyframe − Grundwert) / Spanne.

**Bekannte Punkte**
- `tests/dsp/engine-sanity` „performance budget < 1000 ms“ ist auf diesem Rechner grenzwertig: HEAD (vor Plan 12) misst 860–1130 ms, jetzt ≈ 910–1300 ms (Median +3 %). Schwelle nicht verändert.
- Kein echter Browser-/Hörtest durch Claude; nur jsdom-Smoke-Test der UI. Aufnahme, Latenz-Messung, Datei-Import (decodeAudioData) und Ordner-Speichern sind nur im Browser prüfbar.
