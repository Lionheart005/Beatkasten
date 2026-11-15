# 02 — Das Musikalisch-Mathematische Design (Zeit × Klang × Bewegung)

> **Kernidee:** Wir teilen die kreative Kontrolle klar in **Säule 1 (Zeitliche Struktur / „Phasen-Rätsel“)**, **Säule 2 (Reichhaltige Klangfarben & Verzerrung/Raum)** und **Säule 3 (Wie Zeit den Klang bewegt)**. Jedes Element hat eigene Regler und ist sofort musikalisch spielbar.

---

## SÄULE 1: Zeitliche Manipulation („WANN“ — Das Phasen-Rätsel)

Ein Hörer empfindet Musik als **gleichzeitig eingängig und geheimnisvoll**, wenn einzelne Ebenen streng periodisch sind, ihre **Überlagerung** sich aber über viele Takte verschiebt:

### Die Zeit-Operatoren pro Layer
| Regler / Operator | Musiker-Beschreibung | Mathematischer Kern unter der Haube |
| :--- | :--- | :--- |
| **Zyklus-Länge (`Cycle`)** | Wie viele Beats/Takte dauert *eine* Schleife dieses Layers? (Inkl. `3`, `5`, `7` für Polyrhythmik) | Perioden-Teiler der Master-Phase: $\phi_L = (\text{totalBeats} / L) \bmod 1$. Die UI zeigt das Gesamt-`kgV` im **Phasen-Radar**. |
| **Zeit-Krümmung (`Time Warp`)** | Verbiegt den Zeitfluss im Zyklus: negativ = wird immer schneller, positiv = bremst ab | Monotone Phasenverzerrung $\phi' = \phi^{\gamma}$ ($\gamma \in [0.25, 3.0]$). |
| **Puls-Interferenz (`Density & Interference`)** | Überlagert zwei Sinus/Cosinus-Wellen unterschiedlicher Frequenz gegen eine Schwelle → komplexe, symmetrische Grooves | $\text{energy}(\phi) = \text{rectify}(\sin(2\pi n_1 \phi) + k \cos(2\pi n_2 \phi + \theta) - \tau)$. |
| **Gravitation (`Grid Gravity`)** | Zieht Betonung stufenlos in Richtung **Downbeat**, **Offbeat** oder **Triolen-Puls** (inkl. Direkt-Presets) | Gewichtete Phasen-Anziehung auf das Ziel-Raster. |
| **Kaleidoskop (`Phase Drift`)** | Verschiebt das Muster nach jedem Durchlauf um einen Bruchteil und kehrt nach `N` Takten exakt zurück | $\theta(c) = (\text{driftStep} \cdot c) \bmod 1$ mit `Cycle Reset`. |

### Globale Harmonie (immer aktiv, schützt vor falschen Tönen)
- **Taktart & Tempo** (`4/4`, `3/4`, `5/4`, `7/8`, `90–160 BPM`).
- **Tonart & Modus:** Grundton + Skala (*Aeolian/Nat. Moll, Dorisch, Phrygisch, Harmonisch Moll*) + Akkord-Voicing (*Moll, Moll7, Sus2/Sus4, Powerchord*) sowie optionale langsame Akkord-Fortschreitung alle `4/8/16` Takte.

---

## SÄULE 2: Reine Klangfarben-Manipulation („WIE ES KLINGT“)

Jeder Layer hat zusätzlich zu seiner Zeit-Struktur eine **großzügige Klangformungs-Abteilung**. Alle Regler verändern den Klang **sofort statisch** (man hört direkt beim Drehen den Unterschied, ohne erst eine Modulation einschalten zu müssen!) und haben eingebaute **Sweet-Spot-Grenzen + automatische Lautstärkekompensation** (damit „mehr Verzerrung“ nicht einfach „viel lauter“ wird).

### 1. Die 3 Start-Klangmotoren (`Voices` — bewusst offen statt starrer Drum-Schubladen)
* **`PulseTextureVoice` (Rhythmische Impulse, Kick-Fundamente & Geräusch-Skulpturen):**
  * *Körper vs. Luft* (reine Tiefton-Welle ↔ gefiltertes Rauschen/Atmen),
  * *Schlag-Fall (`Punch Drop`)* (wie tief und schnell der Ton am Anschlag nach unten fällt),
  * *Nachklang (`Decay`)* (trockener Klick ↔ langer Sub-Schwanz),
  * *Anschlag-Härte (`Snap/Softness`)* (samtig eingeschwungen ↔ peitschend).
* **`SubMotionVoice` (Rollende Bässe & Tiefton-Druck):**
  * *Sub-Wärme* (Grundton + subtile Oktave),
  * *Knurren (`Phase Bite`)* (kontrollierte innere Phasen-Reibung),
  * *Gleiten (`Glide`)* (weiches Binden zwischen Tonstufen),
  * *Auto-Duck* (weicht dem Haupt-Puls automatisch aus).
* **`ChordArpVoice` (Stehende Akkorde & Arpeggios):**
  * *Akkord → Arpeggio Morph* (0 % = alle Töne stehend zusammen; >0 % = zeitliches Auffächern),
  * *Oktav-Weite* (kompakter Akkord ↔ weites Schimmern über 3 Oktaven),
  * *Grundklang-Farbe* (flöten-weiche Sinus-Basis ↔ obertonreiche Säge/Puls-Basis),
  * *Choral-Schwebung (`Ensemble Detune`)* (spaltet jede Stimme leicht in schwebende Zwillingswellen auf → satter, breiter Pad-Klang).

### 2. Die universelle Klang-Werkbank pro Layer (`TimbreShaperChain` — immer da!)
Unabhängig von der gewählten Voice stehen jedem Layer **8 musikalische Klangfarben-Regler** zur Verfügung, um vom warmen Keller-Bass bis zur gläsernen Alien-Textur alles direkt zu formen:

| Klang-Regler | Was er klanglich macht (Musiker-Sicht) | Was technisch dahintersteckt |
| :--- | :--- | :--- |
| **1. Helligkeit (`Brightness / Tone`)** | *Dumpf & unter Wasser* ↔ *Neutral* ↔ *Kristallklar & bissig* | Kombiniert musikalischen Tiefpass (links) und sanfte Präsenz-Anhebung (rechts) um eine Mittelstellung. |
| **2. Fokus / Kante (`Resonance Focus`)** | Macht die Grenzfrequenz der Helligkeit *singend, saugend und charakterstark* | Resonanz-Spitze des Zero-Delay-Feedback-Filters (nach oben sicher begrenzt gegen schrilles Pfeifen). |
| **3. Wärme & Verzerrung (`Warmth → Grit`)** | `0–35%`: samtige analoge Sättigung; `35–70%`: röhriges Knurren; `70–100%`: satter Crunch/Overdrive | Asymmetrische Soft-Saturation + hart begrenzte Drive-Stufe mit automatischer RMS-Pegel-Anpassung. |
| **4. Wellen-Geometrie (`Wavefold / Glass`)** | Faltet die Welle weich in sich selbst → erzeugt *holzige, glockige oder metallische Obertöne* | Kontrollierter Sinus-Wavefolder (mit Anti-Aliasing-Filterung). |
| **5. Klang-Körnung (`Sand / Dust`)** | Fügt *samtigen Vinyl-Staub* bis *knirschende digitale Körnigkeit* hinzu | Weich gemischte Sample-Reduktion / Quantisierungs-Textur (ohne schrilles Fiepen). |
| **6. Körper & Hohlraum (`Body Resonator`)** | Lässt den Klang wie ein *gespanntes Holz, ein Metallrohr oder eine Saite* mitschwingen (gestimmt auf die Tonart!) | Kurzer, auf den Grundton gestimmter Kammfilter / Allpass-Resonator. |
| **7. Gewicht / Kipp-EQ (`Weight Tilt`)** | Kippt die Balance: links *massiv & bassstark*, rechts *schlank, drahtig & weit vorne* | Linearer Tilt-Equalizer um ~650 Hz. |
| **8. Stereo-Raumbreite (`Stereo Orbit`)** | Links *eng & fokussiert in der Mitte*, rechts *weit und schwebend links/rechts* | Mid/Side-Breite + dezenter Phasen-Spreizer (Tiefton < 110 Hz bleibt immer mono-stabil!). |

### 3. Klassische Filter & Raum-Effekte (`EffectChain` — ebenfalls komplett klangformend)
1. **Musical EQ (3-Band):** *Bauch / Körper / Luft* (+/- 12 dB, sauber begrenzt).
2. **Charakter-Filter (LP / BP / HP):** Klassischer, extrem geschmeidig reagierender Filter.
3. **Tempo-Sync Echo:** Stereo / Ping-Pong-Delay (`1/8`, `3/16` punktiert, `1/4`, Triole) mit eingebautem *„Dunkler-werden-pro-Echo“*-Regler.
4. **Rhythmischer Hall (Ducking-Reverb):** Raumgröße & Hall-Helligkeit (*dunkler Bunker* ↔ *langer heller Dom*) plus **Auto-Ducking**, damit die Hallfahne auf jedem Schlag Platz für den Punch macht.
5. **Master-Glue (Global):** Mono-Sub-Stabilisierung + analoge Master-Sättigung + Peak-Limiter (-0.5 dB Headroom).

---

## SÄULE 3: Die Brücke — Wie Zeit den Klang bewegt (`ZEIT TRIFFT KLANG`)

Jeder einzelne Regler aus Säule 2 (Helligkeit, Verzerrung, Wavefold, Körper-Resonanz, Stereo-Breite, Hall-Anteil, Echo-Feedback usw.) lässt sich **direkt am Regler** zeitlich animieren – ohne komplizierte Patch-Kabel:

### Das „Regler + Bewegungs-Ring + Karten-Kette“-Prinzip in der UI
1. **Kartenkette per Drag & Drop sortieren:** Die Klang-Karten (*Tone/Filter*, *Wärme/Wavefold*, *Körper/Sand*, *EQ/Breite*, *Echo*, *Ducking-Hall*) lassen sich pro Layer in beliebiger Reihenfolge verschieben – *Verzerrer vor Hall* klingt sofort völlig anders als *Hall vor Verzerrer*, ohne je Kabel stecken zu müssen.
2. **Drehen am Hauptregler:** Stellt den **Basis-Klang** ein (z. B. *Helligkeit = 30 %*, schön dumpf).
3. **Kleiner Bewegungs-Anker (`~`) am selben Regler:**
   - **Tiefe (`Depth`):** Bipolar `-100 %` bis `+100 %` (Standard `0 %` = rein statisch).
   - **Quelle wählen (1 Klick):**
     - **Eigene Takt-Welle (LFO):** z. B. Sinus/Cosinus/Rampe über `1 Beat`, `2 Takte`, `8 Takte` oder `7 Beats` (polyrhythmische Klangfarbe!).
     - **Folge einem Layer-Puls (auch Layer-zu-Layer!):** Klang reagiert dynamisch auf den eigenen Puls *oder* auf einen anderen Layer (z. B. *Layer 1 Kick drückt Hall & Helligkeit von Layer 3 kurz herunter*).
     - **Handgezeichnete Kurve (`+` / `×`):** Öffnet die Kurve im Koordinatensystem über z. B. `8 Takte`.
   - **Welle-auf-Welle:** Eine langsame Makro-Welle kann auch Stärke oder Tempo einer anderen Modulations-Welle steuern (organisches Atmen ohne Audio-Feedback-Chaos).

### Zwei magische Beispiele, was durch `Zeit × Klang` entsteht
* **Beispiel 1 (Klassischer Spannungsbogen):**
  * *Helligkeit* startet bei `20 %` (dumpf), *Verzerrung* bei `10 %` (warm), *Hall* bei `15 %`.
  * Eine `16-Takt-Welle` (oder gezeichnete Kurve) zieht alle drei langsam hoch → in Takt 14 kreischt und glüht der Klang hell im weiten Hallraum → in Takt 16 schnappt er auf dumpf und knochentrocken zurück!
* **Beispiel 2 (Klangfarben-Polyrhythmik — „Das doppelte Rätsel“):**
  * Der Rhythmus eines Layers läuft über **4 Beats**.
  * Aber eine Welle auf *Body Resonator* (Holz ↔ Metall) läuft über **5 Beats** und eine auf *Stereo-Breite* über **7 Beats**!
  * Ergebnis: Selbst ein einziger, simpler Loop klingt wie ein sich ständig neu beleuchtender Kristall, dessen Muster sich erst nach `4 × 5 × 7 = 140` Schlägen wieder genau gleich anfühlt!
