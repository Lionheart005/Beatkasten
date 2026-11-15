# 04 — Test-Strategie & Schrittweiser Entwicklungsplan

> **Warum Testbarkeit hier so wichtig ist:** Da KI das Projekt programmiert und weiterentwickelt, sichern automatisierte Tests, dass neue Voices, Filter oder Operatoren niemals bestehende Beats zerstören, Audio zum Clippen bringen oder Browser-Tabs einfrieren.

---

## 1. Test-Pyramide (Ohne Audio-Hardware im CI/CLI lauffähig)

Weil `@tsg/core` zu 100 % reines TypeScript ohne Browser-Abhängigkeiten ist, können wir den gesamten Klang-Generator in **Node.js / Vitest** direkt testen!

### Ebene 1: Musiktheorie- & Mathe-Unit-Tests
- **Harmony Lock Tests:** Keine generierte Note eines gelockten Layers darf außerhalb der gewählten Skala liegen.
- **Zyklus- & LCM-Tests:** Berechnet `kgV` / Gesamtzyklus korrekt; `phase` liegt immer strikt in `[0, 1)`.
- **Curve-Evaluator Tests:** Spline/Lookup für gezeichnete Kurven bleibt innerhalb der Parameter-Grenzen, verhält sich bei `0` und `1` stetig (nahtloser Loop).
- **History-Tree Tests:** Verzweigen, Zurückspringen, Bookmarken und JSON-Roundtrip (Serialisieren ↔ Deserialisieren) erzeugen exakt identische States.

### Ebene 2: Deterministische DSP- & „Audio-Sanity“-Tests (entscheidend!)
Wir rendern kleine Blöcke (z. B. 4 Takte bei 48 kHz) per `OfflineRenderer` in Node und prüfen automatisiert:
- **Zero-NaN / Zero-Infinity:** Kein einziges Sample darf `NaN` oder `±Infinity` sein (auch bei extremen Regler-Kombinationen!).
- **Headroom / Limiter-Check:** Maximaler Spitzenpegel bleibt strikt `<= 1.0` (kein digitales Clipping).
- **DC-Offset-Check:** Mittelwert des Signals über einen vollen Zyklus liegt nahe `0` (verhindert Lautsprecher-Knacken).
- **Determinismus & Loop-Schluss:** Zweimaliges Rendern desselben Snapshots liefert bitgenau denselben Audio-Buffer; am Ende eines vollständigen `kgV`-Gesamtzyklus schließen sowohl Zeit- als auch Klang-Modulationswellen nahtlos an den Anfang an.
- **Statisch vs. Moduliert (`ModulationRouter`) Tests:** Mit `depth = 0` bleibt das Spektrum über die Zeit exakt konstant (reine statische Klangformung); mit aktiver Takt-Welle/Kurve bewegt sich der effektive Parameter streng periodisch und bleibt garantiert in `[schema.min, schema.max]`.
- **Auto-Gain / Loudness-Stability Test:** Selbst starkes Hochdrehen von *Wärme/Verzerrung (`Grit`)*, *Wavefold* oder *Body Resonator* darf durch die eingebaute Lautheits-Kompensation nicht zu Lautstärke-Sprüngen über sichere Toleranzen führen.
- **Registry-Contract-Tests (Fuzzing für jedes neue Modul):** Jede neu registrierte `Voice` / `TimbreShaper` / `Effect` / `TimeOperator` wird automatisch mit zufälligen Kombinationen (inkl. extremer Modulations-Routings) innerhalb ihrer Schema-Grenzen (`min`..`max`) gefüttert und muss alle Sanity-Checks bestehen!
- **Performance-Budget-Check:** Rendern von 10 Sekunden Audio mit 8 aktiven Layern muss auf Standard-CPU deutlich unter 1 Sekunde liegen (Faktor > 10× Echtzeit).

### Ebene 3: UI & End-to-End-Tests (Playwright)
- App startet fehlerfrei im Browser, `AudioWorklet` lädt ohne Konsolenfehler.
- Hinzufügen eines Layers, Zeichnen einer Kurve, Speichern eines Abschnitts und Auslösen eines WAV-Exports erzeugen eine gültige RIFF-WAV-Datei.

---

## 2. Entwicklungs-Roadmap in sauberen Ausbaustufen

Jede Phase endet mit einem **spielbaren, hörbaren Produkt**, damit du als Musiker direkt testen und Feedback zum Spielgefühl geben kannst!

### Meilenstein 1: Fundament & „Der erste satte Techno-Beat“ (Core + AudioWorklet + Minimal-UI)
- [ ] Projekt-Setup (Vite + TypeScript + React + Vitest; saubere Schichten `src/core`, `src/audio-host`, `src/storage`, `src/ui`, `tests`).
- [ ] `MasterClock`, Harmonie-Engine (`HarmonyContext`) & `ModuleRegistry`-Grundgerüst (getrennte Registries für `time`, `timbre/voices`, `timbre/processors`).
- [ ] Erste 3 Voices: `PulseTextureVoice`, `SubMotionVoice`, `ChordArpVoice`.
- [ ] **Säule 1 (Zeit):** Zyklus-Teiler (`1..16`), `PulseInterference`, `TimeWarp`, `GridGravity` (Triolen / Offbeat Presets).
- [ ] **Säule 2 (Klang — frei sortierbare Kartenkette):** Drag-&-Drop-Karten für `Tone & Focus` (ZDF-SVF + Tilt), `Warmth, Grit & Wavefold` (Saturator mit Auto-Gain + Wavefolder), `Body & Sand` (tonart-gestimmter Kamm-Resonator + Körnung), `Musical EQ & Orbit` (3-Band EQ + Stereo-Breite mit Mono-Sub) & `MasterBus` (Mono-Sub + Saturator + DC-Blocker + Limiter).
- [ ] **Säule 3 (Brücke):** `ModulationRouter` (Takt-Wellen, Layer-zu-Layer-Puls-Kopplung & Welle-auf-Welle direkt per „Bewegungs-Ring“ an jedem Klang-Regler).
- [ ] Live-Wiedergabe im Browser via `AudioWorklet` + Live-Wellenform-Anzeige + erster WAV-Loop-Export.
- [ ] Komplette DSP-Sanity-, Loudness- & Modulations-Test-Suite in Vitest.

### Meilenstein 2: Das „Phasen-Rätsel“, Raum-Effekte & Kurven-Zeichnen
- [ ] `PhaseDrift` („Kaleidoskop“) & `MacroArc` (lange 8–32-Takt-Spannungskurven).
- [ ] Effekt-Erweiterung (als drag-and-drop-fähige Karten): `TempoSyncDelay` (Stereo Echo) & `DuckingReverb` (rhythmisch weichender Hall).
- [ ] **Interaktiver Kurven-Editor (Canvas):** Kurven per Hand mit Raster-Snap zeichnen (`+` / `×`) und beliebig auf Voice-, Karten- oder Zeit-Parameter routen (inkl. leuchtender Hover-Bögen für aktive Kreuz-Modulationen).
- [ ] **Phasen-Radar-Visualisierung:** Zeigt alle Layer-Ringe + Gesamt-Wiederholungszyklus (`kgV`).
- [ ] Verzweigte **History-Tree** (Snapshots, Bookmarks, A/B-Vergleich).

### Meilenstein 3: Song-Abschnitte, Ordnerstruktur & Polishing
- [ ] **Section-Manager:** Beliebig viele Song-Abschnitte verwalten, duplizieren, variieren und per Takt-Quantisierung live umschalten.
- [ ] **Projekt- & Ordnerverwaltung (`BrowserFsAdapter` + `IndexedDB`):** Echte lokale Projekt-Ordnerstruktur inkl. Curve-Presets & Starter-Templates (z. B. *„Hypnotic A-Moll“*, *„Triolen-Rätsel“*, *„Stehender Akkord → Offbeat Arp“*).
- [ ] **Pro-Export:** Pre-Roll-Loop-Export, Einzel-Spur-Export (Stems) als WAV sowie optionaler MP3-Export.

### Meilenstein 4 (Optional): Erweiterung & Desktop-Verpackung
- [ ] Neue modulare Voices & Operatoren nach deinen musikalischen Wünschen einhängen (dank Registry ohne Refactoring).
- [ ] Optional: Verpacken mit **Tauri** als eigenständiges Windows-Desktop-Programm (`.exe`), falls das Browser-Erlebnis noch durch eine native App ersetzt werden soll.
