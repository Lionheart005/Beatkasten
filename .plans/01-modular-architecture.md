# 01 — Modulare Architektur & Erweiterbarkeit

> **Designziel:** Neue Instrumente (Voices), neue Zeit-Operatoren, neue Klang-Shaper/Filter und neue Modulations-Quellen sollen als **abgeschlossene Module** hinzugefügt werden können, **ohne** bestehenden Kern-Code umzuschreiben oder zu refactoren. Gleichzeitig bleiben **Zeit-Logik** und **Klang-Logik** im Code strikt getrennt, lassen sich aber universell kombinieren.

---

## 1. Schichten- und Ordnerstruktur (Strikte Modul-Grenzen)

Alle Domänen- und Audio-Berechnungen sind strikt von Browser-APIs (`window`, `document`, `AudioWorkletGlobalScope`) und React getrennt. Für reibungsloses `AudioWorklet`-Bundling in Vite und volle Windows-Kompatibilität nutzen wir eine schlanke Single-Root-Struktur mit strikten Modul-Grenzen (`src/core` darf nichts aus `ui`, `storage` oder `audio-host` importieren):

```text
TechnoSoundGenerator/
├── .plans/                         # Architektur- & Fortschrittsdokumentation
├── src/
│   ├── core/                       # [100% Pure TypeScript — ZERO DOM/Browser Imports!]
│   │   ├── theory/                 # Skalen, Akkorde, Voicings, Taktarten, kgV/LCM-Zyklen
│   │   ├── math/                   # Wellenfunktionen, Phase-Warping, Interferenz, Kurven-Spline-Eval
│   │   ├── registry/               # Zentrale Registries & Parameter-Schemata
│   │   ├── dsp/                    # DSP-Bausteine (PolyBLEP-Osc, ZDF-SVF, Saturator, Wavefolder, Comb, FDN-Reverb, Limiter)
│   │   ├── time/                   # [SÄULE 1: WANN] Zeit- & Rhythmus-Operatoren (nur Phasen/Trigger/Energie)
│   │   ├── timbre/                 # [SÄULE 2: WIE ES KLINGT] Klang-Engines & frei sortierbare Klang-Karten
│   │   │   ├── voices/             # Austauschbare Klang-Erzeuger (PulseTexture, SubMotion, ChordArp, ...)
│   │   │   ├── shapers/            # Drag-&-Drop Shaper-Karten (Tone & Focus, Grit & Wavefold, Body & Sand, Tilt & Orbit)
│   │   │   └── effects/            # Drag-&-Drop Effekt-Karten (Musical EQ, Resonant Filter, Tempo Echo, Ducking Hall)
│   │   ├── modulation/             # [SÄULE 3: DIE BRÜCKE] Modulations-Quellen, Welle-auf-Welle & Layer-zu-Layer-Router
│   │   ├── engine/                 # MasterClock, LayerMixer, Reorderable Card Chain, OfflineRenderer
│   │   ├── state/                  # Unveränderliches ProjectModel, SectionModel, HistoryTree, Starter-Presets
│   │   └── export/                 # WAV- & MP3-Encoder-Logik
│   │
│   ├── storage/                    # [Projekt- & Dateisystem-Abstraktion]
│   │   ├── ProjectStorageAdapter.ts# Interface für Projekt-Ordner, Presets & Exporte
│   │   ├── BrowserFsAdapter.ts     # File System Access API (echte lokale Windows-Ordner)
│   │   ├── IndexedDbAdapter.ts     # Fallback & automatisches Crash-Recovery
│   │   └── TauriFsAdapter.ts       # (Optional Phase 4) Nativer Desktop-Dateizugriff
│   │
│   ├── audio-host/                 # [Brücke UI <-> AudioWorklet / Web Worker]
│   │   ├── WorkletProcessor.ts     # Dünner Wrapper um src/core/engine im Audio-Thread
│   │   ├── AudioBridge.ts          # Message-basierte Parameter-, Snapshot- & Section-Sync
│   │   ├── ScopeRingBuffer.ts      # Echtzeit-Wellenform-, Spektrum- & Phasen-Daten für Canvas
│   │   └── ExportWorker.ts         # Offline-Rendering in separatem Thread (kein UI-Freeze)
│   │
│   └── ui/                         # [Reine Präsentation — keine DSP-Logik!]
│       ├── components/             # Schema-getriebene Regler inkl. "Bewegungs-Ring", Kurven-Canvas, Phasen-Radar
│       ├── panels/                 # Layer-Stack, Drag-&-Drop Kartenkette, Section-Manager, History-Tree
│       └── store/                  # UI-State-Binding an src/core/state & AudioBridge
│
└── tests/
    ├── unit/                       # Theorie-, Mathe-, Kurven-, Modulations- & History-Tests
    ├── dsp/                        # Deterministische Audio-Sanity-, Loop-, Loudness- & Snapshot-Tests
    └── e2e/                        # Browser-UI & Workflow-Tests
```

---

## 2. Das Trennungs- & Kombinationsprinzip („Orthogonale Domänen“)

Der entscheidende Trick für maximale Übersichtlichkeit und Skalierbarkeit ist die **harte Schnittstellentrennung** zwischen **Zeit** und **Klang**, verbunden über eine **einheitliche Modulations-Schnittstelle**:

### Säule 1: Zeit-Operatoren (`TimeOperatorModule`) wissen NICHTS über Klangfarben
- Sie kennen nur `beatPosition`, `layerPhase ∈ [0, 1)`, `cycleIndex` und `timeSignature`.
- Sie erzeugen pro Block ein **`TimeFrame`**:
  - `warpedPhase`: die ggf. gekrümmte oder gedriftete Phase im Zyklus,
  - `pulseEnergy`: kontinuierliche rhythmische Energie `[0..1]`,
  - `triggerIntensity`: Impulsstärke `[0..1]` bei Rhythmus-Schnitten/Peaks,
  - `accent`: Betonung (z. B. Downbeat vs. Offbeat vs. Triole).

### Säule 2: Klang-Module (`VoiceModule`, `ShaperModule`, `EffectModule`) wissen NICHTS über Takte oder Kurven
- Ein Klangmodul arbeitet rein auf Sample-/Audio-Ebene!
- Ob ein Regler wie *„Helligkeit“* oder *„Verzerrung“* gerade statisch auf `40 %` steht oder sich alle 8 Takte sinusförmig bewegt, ist dem DSP-Filter **völlig egal**: Er liest einfach seinen bereits berechneten Zielwert `effectiveParams['brightness']` (der garantiert in `[min, max]` liegt) und glättet ihn sample-genau.
- **Vorteil:** Man kann beliebig viele neue Klang-Effekte (z. B. neue Verzerrungs-Algorithmen, Resonatoren, Phaser, Granular-Effekte) schreiben, ohne dass sie auch nur eine Zeile Timing- oder Kurven-Logik enthalten müssen!

### Säule 3: Die Brücke (`ModulationRouter`) — Zeit bewegt Klang (inkl. Kreuz-Modulation!)
Jeder Parameter mit `modulatable: true` besitzt in der Architektur zwei Ebenen:
1. **Basiswert (`baseValue`):** Der klassische statische Reglerwert (sofort hörbar, wenn keine Modulation aktiv ist).
2. **Modulations-Verbindungen (`ModulationRoute[]`):** Beliebig viele zeitliche Quellen können gleichzeitig auf denselben Klang-Regler wirken:
   - **Eigene Takt-Welle (`WaveLFO`):** Sinus, Cosinus, Dreieck, Säge oder weicher Puls – gekoppelt an ein **musikalisches Takt-Vielfaches** (`1/4 Beat` bis `32 Takte`) + Phasenversatz!
   - **Layer-Puls (`FollowRhythm` — auch Layer-zu-Layer!):** Koppelt den Klang-Regler an die rhythmische Energie/Betonung des eigenen **oder eines anderen Layers** (z. B. *„Immer wenn Layer 1 kickt, duckt sich Hall/Helligkeit von Layer 2“*).
   - **Handgezeichnete Kurve (`DrawnCurve`):** Frei gezeichnete Verlaufskurve im Koordinatensystem (z. B. über 8 Takte: *dumpf → hell → extrem verzerrt → wieder warm*).
   - **Makro-Spannungsbogen (`MacroArc`):** Globale 8/16/32-Takt-Bewegung für ganze Song-Abschnitte.
   - **Welle-steuert-Welle (`Modulation-on-Modulation`):** Eine Modulations-Route kann auch gezielt die *Stärke (`depth`)* oder *Geschwindigkeit (`rateMultiplier`)* einer anderen Modulations-Route steuern (1-Pass-Auswertung ohne Feedback-Kreise → sicher vor Endlosschleifen!).

---

## 2b. Geordnete Drag-&-Drop-Kartenkette statt unübersichtlicher Node-Spaghetti

Anstelle eines freien Node-Graphen mit In/Out-Buchsen (der schnell zu Kabel-Salat, totem Audio und schrillen Feedback-Schleifen führt) arbeitet jeder Layer mit einer **geordneten, frei sortierbaren Signal-Kartenkette**:
* Alle Basis-Karten (*Voice → Klang-Karten [Tone/Filter, Grit/Wavefold, Body/Sand, EQ/Width] → Raum-Karten [Echo, Ducking-Hall]*) sind immer lückenlos von links nach rechts verbunden – es entsteht niemals ein „totes“ Signal.
* Per **Drag & Drop** lässt sich die **Reihenfolge der Shaper- & Effekt-Karten** jederzeit ändern (z. B. *Verzerrung vor den Hall* vs. *Hall in die Verzerrung* ziehen).
* Einzelne Karten können per Bypass umgangen, neue Karten per `+` an beliebiger Stelle eingeschoben werden.
* In der UI visualisieren dezente leuchtende Bögen beim Hovern, welche Modulations-Quelle auf welchen Regler oder welche Nachbar-Welle wirkt.

#### Saubere mathematische Kombination & Sweet-Spot-Schutz
Für jeden Parameter $p$ mit Bereich $[p_{\min}, p_{\max}]$ berechnet der `ModulationRouter` an Position $t$:

$$p_{\text{eff}}(t) = \text{clamp}\Big(\big(p_{\text{base}} + \sum_{i \in \text{add}} d_i \cdot m_i(t) \cdot (p_{\max} - p_{\min})\big) \cdot \prod_{j \in \text{mul}} \text{lerp}(1, m_j(t), d_j),\; p_{\min},\; p_{\max}\Big)$$

- **Immer innerhalb sicherer Grenzen:** Egal wie viele Wellen oder Kurven sich überlagern, `clamp(..., min, max)` verhindert technisch unmögliche oder schmerzhafte Werte.
- **Null-Aufwand bei neuen Modulen:** Sobald ein neues Instrument oder ein neuer Effekt in der Registry angemeldet wird, kann **jeder** seiner Klang-Regler sofort von jeder Welle und jeder Kurve zeitlich animiert werden!

---

## 3. Schema-getriebene Module & Registries

```ts
// packages/core/registry/types.ts

export type ControlDomain = 'time' | 'timbre' | 'space' | 'harmony';

export interface ParameterSchema {
  id: string;
  label: string;              // Musiker-Name, z.B. "Wärme & Dreck" oder "Helligkeit"
  description: string;        // Verständliche Erklärung ohne Tech-Jargon
  domain: ControlDomain;      // Trennt Zeit- von Klang-Reglern sauber in State & UI
  min: number;                // Harte Sweet-Spot-Untergrenze
  max: number;                // Harte Sweet-Spot-Obergrenze
  defaultValue: number;
  step?: number;
  curve?: 'linear' | 'exp' | 'bipolar';
  modulatable: boolean;       // True -> Kann direkt von Zeit-Wellen/Kurven bewegt werden!
  unitLabel?: string;
}

export interface ModuleDescriptor {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly parameters: readonly ParameterSchema[];
}

export interface TimeOperatorModule extends ModuleDescriptor {
  evaluateTime(ctx: TimeEvalContext, params: Float64Array): TimeContribution;
}

export interface VoiceModule extends ModuleDescriptor {
  readonly category: 'rhythm' | 'bass' | 'harmony' | 'texture';
  createInstance(sampleRate: number): VoiceInstance;
}

export interface TimbreOrEffectModule extends ModuleDescriptor {
  readonly stage: 'timbre-shaper' | 'effect';
  createInstance(sampleRate: number): AudioProcessorInstance;
}
```

---

## 4. Signalfluss innerhalb eines Layers (4 saubere Stufen)

```text
[1. ZEIT-DOMÄNE]   MasterClock -> CycleDivider -> TimeOperators -> TimeFrame (Phase, Trigger, Accent)
                                                                       │
[2. BRÜCKE]        ModulationSources (WaveLFOs, DrawnCurves, TimeFrame) ──► ModulationRouter
                                                                               │
                   (effektive Klang-Parameter pro Control-Block: 8 Samples) ◄──┘
                                 │
                                 ▼
[3. KLANG-QUELLE]  VoiceInstance (z.B. ChordArp / PulseTexture / SubMotion) + HarmonyContext
                                 │
                                 ▼
[4. KLANG-KARTEN]  Drag-&-Drop sortierbare Shaper- & Effekt-Karten pro Layer
                   (z.B. [Tone & Focus] -> [Warmth & Wavefold] -> [Body & Sand] -> [EQ & Orbit] -> [Echo] -> [Ducking-Hall])
                                 │
                                 ▼
[5. MASTER-BUS]    Summe aller Layer -> Sub-Mono (<110 Hz) -> Analog-Saturator -> DC-Blocker -> Limiter
```

### Performance-Optimierung: Control-Rate-Modulation (Audio-Rate nur wo nötig)
- Zeitliche Klang-Veränderungen (Filter auf/zu, Verzerrung hochfahren, Hall weicher machen) berechnen wir alle **8 Samples** (~6.000× pro Sekunde bei 48 kHz) und interpolieren sie linear innerhalb des 8-Sample-Mini-Blocks.
- **Ergebnis:** Null hörbare Treppenstufen (völlig analog-glatt!), aber **8× weniger Rechenlast** für komplexe Kurven- und Wellen-Routings – plus **Zero-Allocation** (`Float32Array`/`Float64Array` vorallokiert) im `AudioWorklet`.
