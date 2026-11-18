# 13 — Kombiniertes Funktions-/Akkord-Menü, Dreiklänge als Standard, Spur-Pegel im Inspektor

> Stand: 18.11.2026 · **Umgesetzt** · Bezug: `verbesserungen.txt` (Runde 7)

## Wünsche → Lösung

| # | Wunsch | Lösung |
|---|---|---|
| 1 | Timeline: Lautstärke und Pan der ganzen Spur auch in den Spur-Einstellungen, Wert als Zahl | `TrackInspector` (`src/ui/timeline/TimelineInspector.tsx`): Regler „Lautstärke“ (0–150 %) und „Pan“ (L/R) mit Zahlenanzeige, Doppelklick = zurücksetzen, Keyframe-Knopf (Automation `scope: 'track'`, `level` / `pan`). Spurhöhe zeigt px. Layer-Zeilen im Clip-Inspektor zeigen Pegel und Pan jetzt auch als Zahl (fett = eigener Wert). |
| 2 | Klassische Akkorde nicht als Chip-Zeile unter den Stufen, nur im Dropdown der Kacheln | Zeile „Klassisch:“ entfernt. Alle Vorlagen (N⁶, ⁺⁶-Akkorde, Zwischendominanten, Picardie, Medianten …) stehen im Kachel-Menü. |
| 3 | Stufen-Knöpfe ohne 7 o. Ä., nur leitereigene Dreiklänge | Neuer Akkordtyp `DIATONIC_TRIAD = 'triad'` (`theory/progression.ts`): leitereigener Dreiklang, unabhängig von der globalen Akkord-Farbe, folgt der Skala (b-Stufe = Dur, #-Stufe = vermindert). Stufen-Knöpfe hängen nur noch `triad` an; die Auswahl „Farbe für neue Akkorde“ ist weg. |
| 4 | Funktion und Akkord nicht trennen; jede Auswahl zeigt Funktion und Harmonie; nach Funktion sortiert, mehr Zusatztöne weiter unten | Neues Modul `theory/chordMenu.ts`: `buildChordMenu(harmony, {degree, accidental})` → Optionen „Funktion · Akkord“ (z. B. „Sp · Dm“, „(D⁷)Tp · E7“, „N⁶ · C#/F“). Gruppen: Tonika, Subdominante, Dominante, Zwischendominanten & DD, Übermäßige Sextakkorde, Medianten & geborgte Akkorde, „Alle Klangfarben auf dieser Stufe“. In jeder Gruppe sortiert nach Zusatztönen (über den Dreiklang hinaus, sus zählt 1), dann nach leiterfremden Tönen. Doppelte Klänge werden entfernt. `findChordMenuOption` findet die passende Option (Vorlage → gleiche Felder → gleicher Klang); passt nichts, zeigt das Menü „aktuell“. Pro Kachel: [b/♮/#] [Stufe] [Funktion · Akkord ▾]; die getrennten Selects „Farbe“ und „Funktion“ sind weg. Kachel-Kopf zeigt die Funktion jetzt für jeden Akkord (`chordFunctionSymbol`). |

## Entscheidungen
- Stufen-/Alterations-Select bleibt als Grundton-Feinwahl (Farbe bleibt erhalten), damit jede Kombination erreichbar bleibt.
- Funktionssymbole nach Riemann (T, Tp, Sp, Dp, tP, tG, dP, D̸, s⁶, DD, (D⁷)X, N). iii in Dur = Dp (Gruppe Dominante).
- Wird von einer Vorlage mit eigenem Bass (N⁶ = Terz im Bass) auf einen normalen Akkord gewechselt, geht der Bass zurück auf Grundton.
- Preset-Kadenzen, die in den Baukasten geladen werden, behalten `auto` (globale Farbe); im Menü wird die klanggleiche Option markiert.

## Tests
- `tests/unit/chord-menu.test.ts` (Dreiklang-Typ, Funktionssymbole, Gruppierung/Sortierung, Vorlagen, Zuordnung).
- `tests/ui/harmony-builder-smoke.test.ts` (jsdom: Stufe anhängen = Dreiklang, Menü-Gruppen, N⁶ wählen).

## Status
- [x] Spur-Pegel/Pan im Inspektor mit Zahlen
- [x] Klassisch-Zeile entfernt, Dreiklänge als Standard
- [x] Kombiniertes Funktions-/Akkord-Menü
- [ ] Hörtest/Browser-Check durch den Nutzer
- Offen/Idee: Notennamen mit b (Des statt C#) für Neapolitaner u. Ä. – die App nutzt überall `NOTE_NAMES` mit #.
