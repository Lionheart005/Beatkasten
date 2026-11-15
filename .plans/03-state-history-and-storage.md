# 03 — State-Modell, History-Baum, Abschnitte & Projektstruktur

> **Designziel:** Der Nutzer verliert *niemals* einen coolen Beat-Zustand, kann zwischen Song-Abschnitten (ohne klassische Timeline) wechseln, alles sauber in Projektordnern organisieren und am Ende perfekt geschnittene WAV/MP3-Loops exportieren.

---

## 1. Unveränderliches State-Modell (`ProjectState`)

Jeder komplette Klangzustand ist ein leichtgewichtiges, rein JSON-serialisierbares Objekt (kein Audio-Buffer darin – nur die mathematische Konfiguration, genau wie in `Kontext.txt` gewünscht!):

```ts
export interface BeatSnapshot {
  readonly id: string;
  readonly tempoBpm: number;
  readonly timeSignature: { numerator: number; denominator: number };
  readonly harmony: {
    rootNote: number;         // 0..11 (C..B)
    scaleId: string;          // z.B. 'natural_minor', 'dorian', 'phrygian'
    chordPreset: string;      // z.B. 'minor', 'minor7', 'sus2'
  };
  readonly layers: readonly LayerConfig[];
  readonly masterFx: readonly EffectConfig[];
}

export interface ProcessorCardConfig {
  readonly id: string;                // Eindeutige Karten-ID im Layer (für Drag-&-Drop-Reihenfolge & Mod-Targeting)
  readonly moduleId: string;          // z.B. 'tone-filter', 'warmth-wavefold', 'body-sand', 'musical-eq', 'tempo-echo', 'ducking-hall'
  readonly version: number;
  readonly bypassed: boolean;
  readonly params: Record<string, number>;
}

export interface LayerConfig {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly level: number;             // 0..1
  readonly pan: number;               // -1..+1
  readonly cycleLength: {
    value: number;                    // z.B. 1, 3, 4, 5, 7, 8, 16
    unit: 'beat' | 'bar';
  };
  // SÄULE 1: Zeitliche Struktur-Operatoren
  readonly timeOperators: readonly OperatorConfig[];
  // SÄULE 2: Klang-Erzeugung + frei per Drag & Drop sortierbare Shaper- & Effekt-Karten
  readonly voice: {
    moduleId: string;
    version: number;
    params: Record<string, number>;
  };
  readonly processorChain: readonly ProcessorCardConfig[];
  // SÄULE 3: Zeit -> Klang Brücke (inkl. Layer-zu-Layer & Welle-auf-Welle)
  readonly modulations: readonly ModulationRouteConfig[];
}

export interface ModulationRouteConfig {
  readonly id: string;
  readonly sourceType: 'wave-lfo' | 'layer-pulse' | 'drawn-curve' | 'macro-arc';
  readonly sourceConfig: {
    sourceLayerId?: string;           // Optional: anderer Layer für Layer-zu-Layer-Steuerung!
    waveform?: 'sine' | 'cosine' | 'triangle' | 'ramp-up' | 'ramp-down';
    cycleValue?: number;
    cycleUnit?: 'beat' | 'bar';
    phaseOffset?: number;
    curveId?: string;
  };
  readonly targetDomain: 'voice' | 'processor' | 'time' | 'modulation';
  readonly targetCardId: string;      // Bei 'modulation': ID der Ziel-ModulationRoute!
  readonly targetParamId: string;     // Bei 'modulation': 'depth' | 'rateMultiplier'
  readonly combineMode: 'add' | 'multiply';
  readonly depth: number;             // Bipolar -1..+1
}
```

### Warum reine Config statt Audio-Spuren so mächtig ist:
- Ein ganzer komplexer Beat ist nur **wenige Kilobyte groß**.
- Tausende History-Zustände brauchen kaum Speicher.
- Umschalten zwischen Song-Abschnitten passiert in Millisekunden (mit weichem Parameter-Crossfade gegen Knacken).

---

## 2. Verzweigte History („Kein Verlust von Happy Accidents“)

Klassisches `Ctrl+Z` (lineares Undo) hat einen bekannten Nachteil: Wenn man 10 Schritte zurückgeht, etwas Neues ausprobiert und feststellt, dass der alte Ast besser war, ist der alte Ast weg!

Deshalb verwenden wir einen **History-Baum (DAG / Tree)**:
* **Automatische Snapshots (debounced):** Dreht der Nutzer an einem Regler, wird nach kurzer Pause (~400 ms) oder beim Loslassen ein Knoten im History-Baum angelegt – mit automatischem Kurztitel (z. B. *„Chord→Arp +35 %“*, *„Layer 2: 5-Beat Zyklus“*).
* **Pin / Bookmark (Sternchen):** Jeder Zustand lässt sich mit einem Klick als „Meilenstein“ markieren und benennen (z. B. *„Hypnotischer Offbeat-Moment“*).
* **Verzweigungen bleiben erhalten:** Geht man zurück und schraubt in eine neue Richtung, entsteht ein neuer Zweig im Baum. Man kann jederzeit visuell zwischen allen Zweigen hin- und herspringen und sie live vergleichen (A/B-Vergleich!).

---

## 3. Song-Abschnitte (Sections ohne Timeline)

Wie in `Kontext.txt` gewünscht, baut man keine lineare Spur, sondern eine Liste/Palette von **Song-Abschnitten**:
* Beispiel-Palette eines Projekts:
  1. `01_Intro_Pulse` (nur Sub + gedämpfter 3-Beat-Klick)
  2. `02_Main_Groove` (alle 4 Layer aktiv, volle Interferenz)
  3. `03_Break_Chord_Arp` (Bass raus, A-Moll-Akkord geht ins beschleunigende Arpeggio + Hall)
  4. `04_Drop_Offbeat` (volle Energie, Offbeat-Gravitation aktiv)
* **Workflow:**
  - Ein Abschnitt ist ein gespeicherter `BeatSnapshot` mit Namen, Notiz und optionaler Ziel-Exportlänge (z. B. `8 Takte` oder `16 Takte`).
  - **Duplizieren & Variieren:** Man dupliziert `Main_Groove` zu `Break`, dreht die Regler um – fertig.
  - **Optional (Phase 3):** „Live-Trigger / Auto-Morph“ – im Jam-Modus per Klick zum nächsten Takt sauber in den nächsten Abschnitt wechseln (quantisiert auf den nächsten Taktanfang!).

---

## 4. Projekt- & Ordnerstruktur auf der Festplatte

Über den `ProjectStorageAdapter` (im Browser über die **File System Access API** direkt auf einem gewählten Projektordner auf Windows, plus Auto-Backup in `IndexedDB`) entsteht eine saubere, menschenlesbare Ordnerstruktur:

```text
MeinTechnoOrdner/                      <-- Vom Nutzer gewählter Workspace-Ordner
└── Projekte/
    └── Hypnotic_A_Minor/
        ├── project.json               # Metadaten, aktive Settings, Verweise
        ├── history.json               # Kompletter verzweigter History-Baum
        ├── sections/
        │   ├── 01_Intro_Pulse.json
        │   ├── 02_Main_Groove.json
        │   └── 03_Break_Arp.json
        ├── curves/                    # Wiederverwendbare handgezeichnete Kurven
        │   └── offbeat_ramp_4bars.json
        └── exports/                   # Gerenderte Audio-Dateien für die DAW
            ├── 01_Intro_Pulse_130bpm_8bars.wav
            ├── 02_Main_Groove_130bpm_16bars.wav
            └── stems/                 # Optional: Jeder Layer als einzelne WAV!
                ├── 02_Main_Groove_L1_Sub.wav
                └── 02_Main_Groove_L2_ChordArp.wav
```

### Besonderes Feature für die DAW-Weiterverarbeitung: **Stem-Export & Tail-Option**
- **Nahtloser Loop-Export:** Das Offline-Rendering rendert optional einen Vorlauf („Pre-Roll“, z. B. 2 Takte, damit Hall- und Delay-Fahnen schon am Loop-Anfang eingeschwungen sind!) und schneidet dann sample-genau `N` Takte heraus → absolut knackfreies Looping in jeder DAW (Ableton, FL Studio, Logic, Cubase, Reaper).
- **Einzel-Spur-Export (Stems):** Auf Knopfdruck exportiert das Programm nicht nur den fertigen Mix eines Abschnitts, sondern jeden Layer einzeln als WAV – ideal, wenn du in deiner DAW später noch Übergänge oder eigene Melodien darüber arrangieren willst.
