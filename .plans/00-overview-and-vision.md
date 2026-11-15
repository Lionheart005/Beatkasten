# 00 — Projektübersicht, Leitprinzipien & Tech-Stack

> **Ziel des Projekts:** Ein standalone, timeline-freier Techno-Beat- & Klangstruktur-Generator für Musiker mit Musiktheorie-Verständnis (ohne Sound-Ingenieur-Jargon), der aus periodischen mathematischen Wellen, überlagerten Zyklen, handgezeichneten Kurven und musikalisch gekapselten Klang-Motoren komplexe, zugleich aber streng periodische („rätselhafte“, hypnotische) Beats mit sattem Club-Sound erzeugt.

---

## 1. Kernphilosophie („Non-Negotiables“)

1. **Keine klassische Timeline, keine leere Leinwand:**
   - Statt einzelner MIDI-Noten oder Audio-Clips auf einer Zeitachse arbeitet das System ausschließlich mit **periodischen Zuständen** (Beats, Takten, Zyklus-Vielfachen) und speicherbaren **Song-Abschnitten (Sections)**.
   - Alle Basis-Module und Filter sind standardmäßig aktiv und musikalisch sinnvoll voreingestellt („Everything is alive out of the box“).
2. **Musiker-Sprache statt Tontechniker-Jargon:**
   - Die Oberfläche nutzt musiktheoretische Begriffe (Taktart, Tonart/Modus, Akkord, Arpeggio, Triole, Offbeat, Dichte, Wärme, Druck, Schärfe, Spannung) statt kryptischer DSP-Parameter.
   - Jeder Regler besitzt **harte, klanglich geprüfte Boundaries („Sweet-Spot Clamping“)**, damit versehentliches Drehen nicht im unharmonischen Fiepen oder in übersteuertem Rauschen endet.
3. **Drei-Säulen-Trennung unter der Haube (`ZEIT` × `KLANG` × `BEWEGUNG`):**
   - **Zeit-Operatoren (`WANN`):** Laufen synchron zur musikalischen Phase (`0..1` pro Takt oder `N`-fachem Zyklus). Hier finden Sinus-Interferenzen, Time-Warping (Beschleunigung), Akkord→Arpeggio-Morphs, Offbeat-Gravitation und Phasen-Drift statt.
   - **Klangfarben- & Textur-Formung (`WIE ES KLINGT`):** Reichhaltige, musikalisch benannte Klang-Regler (Helligkeit, Wärme/Verzerrung, Oberton-Faltung, gestimmte Körper-Resonanz, Stereo-Breite, Filter, Echo, Ducking-Hall) mit eingebauter Lautheits-Kompensation und gekapselten Klang-Motoren. Diese funktionieren zunächst **rein statisch** wie klassische Klangregler.
   - **Modulations-Brücke (`ZEIT TRIFFT KLANG`):** Jeder klangverändernde Regler kann über einen einheitlichen Mechanismus (eigene Takt-Wellen, Layer-Puls oder handgezeichnete Kurven) zeitlich bewegt werden – z. B. *am Anfang dumpf und trocken, über 8 Takte langsam heller, dreckiger und halliger, und vor dem nächsten Zyklus zurück in den Druck*.
4. **Hohe Komplexität durch verschränkte Periodizität („Das Phasen-Rätsel“):**
   - Einzelne Layer und Modulationswellen laufen auf unterschiedlichen, ganzzahligen oder rationalen Zyklus-Längen (`1`, `2`, `3`, `4`, `5`, `7`, `8`, `16` Beats/Takte).
   - Jede Ebene für sich ist streng periodisch; die Gesamtkonstellation wiederholt sich erst am kleinsten gemeinsamen Vielfachen (`kgV` / LCM) – ein lebendiges, rätselhaftes Muster statt statischer 1-Takt-Schleife.
5. **Verlustfreie Experimentierfreiheit (Branching History & Sections):**
   - Jede relevante Änderung erzeugt leichte, serialisierbare Snapshots in einem verzweigten **History-Baum** („Zurückspringen zu jedem coolen Zustand“).
   - Gelungene Zustände lassen sich als **Song-Abschnitte** speichern und am Ende als **WAV** (Standard für Weiterverarbeitung in DAWs) oder **MP3** exportieren.

---

## 2. Technologie-Entscheidung & Plattform-Strategie

### Gewählter Stack: **Pure TypeScript Core + Web Audio (`AudioWorklet`) + React/Canvas UI**
*(Optional später verpackbar als Desktop-`.exe` über **Tauri** ohne Code-Umbau)*

| Schicht | Technologie | Begründung |
| :--- | :--- | :--- |
| **DSP- & Domänen-Kern (`core`)** | **Reines TypeScript** (zero DOM/Browser dependencies, strikte Typed Arrays `Float32Array`/`Float64Array`, 0 Allocations im Audio-Loop) | Läuft identisch im Browser (`AudioWorklet`), im Web Worker (Offline-WAV/MP3-Export) und in **Node.js / Vitest** (schnelle, deterministische automatisierte Audio-Tests). |
| **Echtzeit-Audio** | **Web Audio API (`AudioWorkletProcessor`)** | Läuft auf einem dedizierten High-Priority-Audio-Thread (128-Sample-Blöcke), völlig entkoppelt von UI-Animationen. Performance reicht für 10–16 parallele Wave-Layer + Filter + Hall locker aus (< 5–10 % CPU). |
| **Benutzeroberfläche** | **Vite + React + TypeScript + HTML5 Canvas / SVG** | Beste KI-Codequalität für interaktive Kurven-Zeichenflächen, Echtzeit-Wellenformen, Phasen-Radar und datengetriebene Regler. |
| **Projekt-Dateien & Speicher** | **Storage Adapter Pattern** (`File System Access API` im Browser + `IndexedDB` Auto-Save; später optional Tauri FS) | Ermöglicht bereits in Chrome/Edge direktes Arbeiten auf einem echten lokalen Projektordner auf Windows. |
| **Export** | **Nativer RIFF-WAV-Encoder** (Pure TS) + **`lamejs` / WASM** für MP3 im Web Worker | Schneller Offline-Render ohne UI-Freeze; sample-genaues Loop-Cutting für nahtlose DAW-Loops. |
| **Test-Framework** | **Vitest** (Unit/DSP/Golden-Audio-Tests) + **Playwright** (UI/E2E) | Garantiert Refactoring-Sicherheit bei jeder Erweiterung. |

### Warum nicht C#, Java, Python oder direkt Rust/WASM?
- **Python:** Zu langsam/unhandlich für latenzarme Echtzeit-DSP + flüssige interaktive Kurven-GUIs.
- **C# (.NET) / Java:** Für Desktop grundsätzlich möglich, aber Web Audio + Canvas schlägt Desktop-GUI-Frameworks bei visuellem Curve-Editing, schnellen KI-Iterationen und sofortiger Ausführbarkeit deutlich.
- **Rust → WASM:** Prinzipiell höchste DSP-Performance, erzeugt aber im Zusammenspiel mit `AudioWorklet` (SharedArrayBuffer/COOP-COEP-Header, Bundle-Loading) unnötige Build-Komplexität und erfordert erst eine lokale Rust-Toolchain. **Architektur-Vorteil:** Da unser DSP-Core hinter klaren Schnittstellen liegt (`TimeOperatorModule`, `VoiceModule`, `TimbreOrEffectModule`), kann bei Bedarf später ein einzelner besonders rechenintensiver Knoten als WASM-Modul eingehängt werden, ohne die App umzubauen.
- **Desktop-Gefühl auf Wunsch:** Da UI und Core sauber abstrahiert sind, lässt sich die komplette Web-App später in einem einzigen Schritt in **Tauri** als native Windows-Desktop-App (`.exe` mit nativen OS-Ordnerdialogen) verpacken.

---

## 3. Abgrenzung MVP vs. Vollausbau

* **Phase 1 (Solides Fundament & erster Groove):** Taktart/BPM, Tonart-Lock, 3 Basis-Voices (*Rhythmus/Geräusch-Impuls*, *Sub/Bass*, *Stehender Akkord → Arpeggio*), getrennte Zeit-Operatoren + breite Klangfarben-Stufe (*Helligkeit, Resonanz-Fokus, Wärme/Verzerrung, Wavefold, Sand, Körper-Resonator, Weight Tilt, Stereo-Breite*), integrierte **Modulations-Brücke** (jeder Klangregler auch durch Takt-Wellen oder Puls bewegbar), Basis-Effekte (EQ, Filter, Delay, Ducking-Hall, Master-Saturator/Limiter), Live-Sound + WAV-Export + Undo/Snapshot-History.
* **Phase 2 (Kreatives Labor):** Beliebig stackbare Layer, interaktiver Kurven-Editor (`+` / `×`, Grid-Snap), Song-Abschnitte-Manager, verzweigter History-Baum, lokale Ordner-Projektstruktur + MP3-Export.
* **Phase 3 (Fortgeschrittenes Instrument):** Nahtloses Morphing zwischen Song-Abschnitten, zusätzliche Voices/Operatoren über das Plugin-System, optionaler Tauri-Desktop-Wrapper.
