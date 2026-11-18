import { describe, expect, it } from 'vitest';
import { defaultRegistry, createDefaultRegistry } from '../../src/core/defaultRegistry';
import { buildFixedPitchFrame, LayerEngine } from '../../src/core/engine/LayerEngine';
import { ModulationRouter } from '../../src/core/modulation/ModulationRouter';
import type { HarmonyFrame, VoiceModule, VoiceRenderContext } from '../../src/core/registry/types';
import {
  createBellsAndOrganPreset,
  createDefaultLayer,
  createHardtechnoProject,
  createHypnoticAMinorProject,
  createNachtschichtProject,
  migrateLayerTime,
} from '../../src/core/state';
import type { BeatSnapshot, LayerConfig } from '../../src/core/state/types';
import { buildHarmonyTimeline, computeHarmonyFrame, type ChordStepConfig } from '../../src/core/theory';
import {
  euclidCells,
  GRID_ACCENT,
  GRID_HIT,
  GRID_OFF,
  GRID_TIE,
  gridParamsFromCells,
  readGridCells,
} from '../../src/core/time/operators';
import { VOICE_MODULES } from '../../src/core/timbre/voices';

const SR = 48000;
const HARMONY = computeHarmonyFrame(9, 'natural_minor', 'minor7', 'static', 0);

function withGrid(layer: LayerConfig, params: Record<string, number>): LayerConfig {
  return {
    ...layer,
    timeOperators: layer.timeOperators.map((op) =>
      op.moduleId === 'time-step-grid' ? { ...op, bypassed: false, params: { ...op.params, ...params } } : op,
    ),
  };
}

interface RunResult {
  triggers: number[];
  gates: number[];
  rms: number[];
}

/** Renders `cycles` 4-beat cycles at 120 BPM, returns per-sub-block telemetry. */
function run(
  layer: LayerConfig,
  cycles: number,
  harmony: HarmonyFrame = HARMONY,
  registry = defaultRegistry,
): RunResult {
  const engine = new LayerEngine(SR, 512);
  engine.syncConfig(layer, registry);
  const router = new ModulationRouter();
  router.prepareSnapshot({ layers: [layer], curves: [] } as unknown as BeatSnapshot);
  const spb = SR / 2;
  const total = Math.round(cycles * 4 * spb);
  const out: RunResult = { triggers: [], gates: [], rms: [] };
  for (let pos = 0; pos < total; pos += 32) {
    engine.renderBlock(pos / spb, 32, 120, 4, harmony, router, new Map(), true);
    out.triggers.push(engine.lastTriggerIntensity);
    let e = 0;
    for (let i = 0; i < 32; i++) e += engine.bufL[i]! * engine.bufL[i]!;
    out.rms.push(Math.sqrt(e / 32));
  }
  return out;
}

const countEdges = (xs: number[]) => {
  let n = 0;
  let prev = 0;
  for (const t of xs) {
    if (t > 0.01 && prev <= 0.01) n++;
    prev = t;
  }
  return n;
};

describe('Rhythmus-Raster (time-step-grid)', () => {
  it('neue Layer haben das Raster statt Puls-Interferenz / Gravitation', () => {
    const l = createDefaultLayer('N', 'pulse-texture');
    const ids = l.timeOperators.map((o) => o.moduleId);
    expect(ids).toContain('time-step-grid');
    expect(ids).not.toContain('time-pulse-interference');
    expect(ids).not.toContain('time-grid-gravity');
    expect(ids).not.toContain('time-euclid');
  });

  it('Bitmasken bleiben bei 64 Steps verlustfrei (inkl. Akzent & Haltebogen)', () => {
    const cells = Array.from({ length: 64 }, (_, i) =>
      i % 7 === 0 ? GRID_ACCENT : i % 5 === 0 ? GRID_HIT : i % 11 === 0 ? GRID_TIE : GRID_OFF,
    );
    const params = { steps: 64, ...gridParamsFromCells(cells) };
    expect(readGridCells(params)).toEqual(cells);
  });

  it('feuert genau die gesetzten Schläge, Haltebögen lösen nicht neu aus', () => {
    const base = createDefaultLayer('G', 'pulse-texture');
    // x . x – – . x .  → 3 Schläge pro Zyklus
    const cells = [GRID_HIT, GRID_OFF, GRID_HIT, GRID_TIE, GRID_TIE, GRID_OFF, GRID_ACCENT, GRID_OFF];
    const r = run(withGrid(base, { steps: 8, ...gridParamsFromCells(cells) }), 3);
    expect(countEdges(r.triggers)).toBe(9);
    // 1 Step pro Zyklus → triggert trotzdem in jedem Zyklus
    const one = run(withGrid(base, { steps: 1, ...gridParamsFromCells([GRID_HIT]) }), 4);
    expect(countEdges(one.triggers)).toBe(4);
    // Zusatz-Schläge (Euklid) ergänzen ein leeres Muster
    const fill = run(withGrid(base, { steps: 16, ...gridParamsFromCells([]), fillHits: 5 }), 2);
    expect(countEdges(fill.triggers)).toBe(10);
  });

  it('Verzögerung schiebt die Schläge später', () => {
    const base = createDefaultLayer('D', 'pulse-texture');
    const first = (delay: number) =>
      run(withGrid(base, { steps: 4, ...gridParamsFromCells([GRID_HIT, GRID_OFF, GRID_OFF, GRID_OFF]), delay }), 1)
        .triggers.findIndex((t, i) => i > 0 && t > 0.01);
    // 1 Step = 1 Beat = 24000 Samples = 750 Sub-Blöcke; 0,5 Step später ≈ +375 Blöcke
    expect(first(0.5)).toBeGreaterThan(330);
    expect(first(0.5)).toBeLessThan(420);
  });
});

describe('Töne aushalten (Halten / Sustain)', () => {
  it('ein gehaltener Kick klingt weiter, ohne Halten klingt er aus', () => {
    const base = createDefaultLayer('K', 'hard-kick');
    const held = gridParamsFromCells([GRID_HIT, GRID_TIE, GRID_TIE, GRID_TIE]);
    const layer = (sustain: number): LayerConfig => ({
      ...withGrid(base, { steps: 4, ...held, gateLen: 1 }),
      voice: { ...base.voice, params: { ...base.voice.params, sustain, rumble: 0 } },
      processorChain: [],
    });
    const lateRms = (r: RunResult) => {
      const a = Math.floor(r.rms.length * 0.6);
      const b = Math.floor(r.rms.length * 0.9);
      return r.rms.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
    };
    const free = lateRms(run(layer(0), 1));
    const sus = lateRms(run(layer(1), 1));
    expect(sus).toBeGreaterThan(0.05);
    expect(sus).toBeGreaterThan(free * 20);
  });

  it('alle Anschlag-Instrumente haben den gemeinsamen Halten-Regler', () => {
    for (const id of ['pulse-texture', 'hard-kick', 'metal-hat', 'clap-snare', 'acid-line', 'reese-bass', 'fm-bass', 'modal-bell']) {
      const mod = defaultRegistry.getVoice(id)!;
      const p = mod.parameters.find((x) => x.id === 'sustain');
      expect(p, id).toBeDefined();
      expect(p!.group).toBe('envelope');
    }
  });

  it('jeder Klang-Regler aller Instrumente gehört zu einer Gruppe, Gruppen stehen zusammen', () => {
    for (const mod of VOICE_MODULES) {
      const groups = mod.parameters.map((p) => p.group);
      expect(groups.every((g) => g !== undefined), mod.id).toBe(true);
      const seen = new Set<string>();
      let last = '';
      for (const g of groups as string[]) {
        if (g !== last) {
          expect(seen.has(g), `${mod.id}: Gruppe ${g} zerrissen`).toBe(false);
          seen.add(g);
          last = g;
        }
      }
    }
  });
});

/** Test-Voice, die nur mitschreibt, welche Harmonie sie sieht. */
function probeRegistry(category: VoiceModule['category'], seen: HarmonyFrame[]) {
  const reg = createDefaultRegistry();
  reg.registerVoice({
    id: 'probe',
    version: 1,
    category,
    displayName: 'Probe',
    description: '',
    parameters: [],
    createInstance: () => ({
      reset() {},
      process(outL: Float32Array, _r: Float32Array, _p: Record<string, number>, ctx: VoiceRenderContext) {
        seen.push({ ...ctx.harmony });
        outL.fill(0.5);
      },
    }),
  });
  return reg;
}

describe('Fester Ton & Bass-Spalte', () => {
  it('fester Ton koppelt den Layer von den Akkorden ab', () => {
    const f = buildFixedPitchFrame({ mode: 'fixed', note: 2, octave: -1 });
    expect(f.rootMidi).toBe(26); // D1
    expect(new Set(f.scaleNotesMidi.map((m) => m % 12))).toEqual(new Set([2]));
    expect(new Set(f.chordNotesMidi.map((m) => m % 12))).toEqual(new Set([2]));

    const seen: HarmonyFrame[] = [];
    const reg = probeRegistry('harmony', seen);
    const base = createDefaultLayer('F', 'pulse-texture');
    const layer: LayerConfig = {
      ...base,
      voice: { moduleId: 'probe', version: 1, params: {} },
      pitch: { mode: 'fixed', note: 7, octave: 0 },
    };
    run(layer, 0.1, HARMONY, reg);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => h.rootMidi === 43)).toBe(true); // G2 statt A-Akkord
  });

  it('Bass-Spalte: Umkehrung, freier Basston, Pause, grundtonloser Akkord', () => {
    const step = (patch: Partial<ChordStepConfig>): ChordStepConfig => ({
      id: Math.random().toString(36),
      degree: 0,
      accidental: 0,
      chordType: 'major',
      durationBeats: 4,
      transitionType: 'cut',
      transitionBeats: 0,
      ...patch,
    });
    const tl = buildHarmonyTimeline(
      {
        rootNote: 0,
        scaleId: 'major',
        chordPreset: 'major',
        progressionId: 'static',
        progressionMode: 'custom',
        customSteps: [
          step({ bass: 'third' }),
          step({ degree: 4, bass: 'degree', bassDegree: 3 }),
          step({ degree: 5, chordType: 'minor', bass: 'none' }),
          step({ degree: 3, chordType: 'maj7', omitRoot: true }),
        ],
      },
      4,
    );
    const [c, g, a, f] = tl.steps;
    expect(c!.chordName).toBe('C/E');
    expect(((c!.frame.bassMidi! % 12) + 12) % 12).toBe(4);
    expect(c!.frame.rootMidi % 12).toBe(0);
    expect(g!.chordName).toBe('G/F');
    expect(a!.frame.bassRest).toBe(true);
    expect(f!.frame.chordNotesMidi.some((m) => m % 12 === 5)).toBe(false); // ohne F
    expect(f!.frame.chordNotesMidi.length).toBeGreaterThanOrEqual(3);
  });

  it('Bass-Instrumente spielen den Basston, pausieren bei „Kein Bass“', () => {
    const tl = buildHarmonyTimeline(
      {
        rootNote: 0,
        scaleId: 'major',
        chordPreset: 'major',
        progressionId: 'static',
        progressionMode: 'custom',
        customSteps: [
          { id: 'a', degree: 0, accidental: 0, chordType: 'major', durationBeats: 4, transitionType: 'cut', transitionBeats: 0, bass: 'fifth' },
          { id: 'b', degree: 0, accidental: 0, chordType: 'major', durationBeats: 4, transitionType: 'cut', transitionBeats: 0, bass: 'none' },
        ],
      },
      4,
    );
    const seen: HarmonyFrame[] = [];
    const reg = probeRegistry('bass', seen);
    const base = createDefaultLayer('B', 'pulse-texture');
    const layer: LayerConfig = { ...base, voice: { moduleId: 'probe', version: 1, params: {} }, processorChain: [] };
    run(layer, 0.1, tl.steps[0]!.frame, reg);
    expect(seen.every((h) => h.rootMidi % 12 === 7)).toBe(true); // G im Bass

    const rest = run(layer, 0.5, tl.steps[1]!.frame, reg);
    const tail = rest.rms.slice(-50);
    expect(Math.max(...tail)).toBeLessThan(1e-3); // weich ausgeblendet
  });
});

describe('Migration der alten Wann-Kette', () => {
  const legacy = (patch: (l: LayerConfig) => LayerConfig) =>
    patch(createDefaultLayer('L', 'pulse-texture', 4, 'beats', { legacyTime: true }));
  const setOp = (l: LayerConfig, moduleId: string, bypassed: boolean, params: Record<string, number> = {}) => ({
    ...l,
    timeOperators: l.timeOperators.map((o) =>
      o.moduleId === moduleId ? { ...o, bypassed, params: { ...o.params, ...params } } : o,
    ),
  });

  it('gerade Puls-Interferenz → Raster mit allen Schlägen', () => {
    const m = migrateLayerTime(legacy((l) => setOp(l, 'time-pulse-interference', false, { freqA: 4 })));
    const grid = m.timeOperators.find((o) => o.moduleId === 'time-step-grid')!;
    expect(grid.params.steps).toBe(4);
    expect(readGridCells(grid.params).every((c) => c === GRID_HIT)).toBe(true);
    expect(m.timeOperators.some((o) => o.moduleId === 'time-grid-gravity')).toBe(false);
    expect(migrateLayerTime(m)).toBe(m); // idempotent
  });

  it('Offbeat-Interferenz bleibt auf dem Offbeat', () => {
    const m = migrateLayerTime(
      legacy((l) =>
        setOp(l, 'time-pulse-interference', false, { freqA: 4, freqB: 4, interferenceMix: 1, phaseOffset: 0.5, threshold: 0.15 }),
      ),
    );
    const grid = m.timeOperators.find((o) => o.moduleId === 'time-step-grid')!;
    const cells = readGridCells(grid.params);
    const n = cells.length;
    const hits = cells.map((c, i) => (c !== GRID_OFF ? i / n : -1)).filter((x) => x >= 0);
    expect(hits.length).toBeGreaterThan(0);
    // Mischung 1 mit Versatz 0,5 → Gipfel zwischen den Zählzeiten (nicht auf 0, 1/4 …)
    expect(hits.every((u) => Math.abs(u * 4 - Math.round(u * 4)) > 0.01)).toBe(true);
  });

  it('Euklid → Bitmuster, modulierte Schläge → Zusatz-Schläge', () => {
    const e = legacy((l) =>
      setOp(setOp(l, 'time-pulse-interference', true), 'time-euclid', false, { euclidSteps: 8, euclidHits: 3 }),
    );
    const m = migrateLayerTime(e);
    const grid = m.timeOperators.find((o) => o.moduleId === 'time-step-grid')!;
    expect(readGridCells(grid.params).map((c) => (c === GRID_OFF ? '.' : 'x')).join('')).toBe('x..x..x.');

    const eid = e.timeOperators.find((o) => o.moduleId === 'time-euclid')!.id;
    const routed: LayerConfig = {
      ...e,
      modulations: [
        {
          id: 'r1',
          enabled: true,
          sourceType: 'wave-lfo',
          sourceConfig: { waveform: 'ramp-up', cycleValue: 16, cycleUnit: 'bars' },
          targetDomain: 'time',
          targetCardId: eid,
          targetParamId: 'euclidHits',
          combineMode: 'add',
          depth: 0.3,
        },
      ],
    };
    const mr = migrateLayerTime(routed);
    const g2 = mr.timeOperators.find((o) => o.moduleId === 'time-step-grid')!;
    expect(g2.params.fillHits).toBe(3);
    expect(mr.modulations[0]!.targetCardId).toBe(g2.id);
    expect(mr.modulations[0]!.targetParamId).toBe('fillHits');
  });

  it('Presets & Demo-Songs enthalten nur noch das Raster', () => {
    const snaps = [
      createHypnoticAMinorProject().activeSnapshot,
      createBellsAndOrganPreset(),
      ...createNachtschichtProject().sections.map((s) => s.snapshot),
      ...createHardtechnoProject().sections.map((s) => s.snapshot),
    ];
    for (const s of snaps) {
      for (const l of s.layers) {
        const ids = l.timeOperators.map((o) => o.moduleId);
        expect(ids.some((id) => id === 'time-pulse-interference' || id === 'time-euclid' || id === 'time-grid-gravity')).toBe(false);
      }
    }
  });

  it('Euklid-Helfer liefert Zellen', () => {
    expect(euclidCells(8, 5).map((c) => (c === GRID_OFF ? '.' : 'x')).join('')).toBe('x.xx.xx.');
  });
});
