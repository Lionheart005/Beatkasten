import { gridGravityPull, wrapPhase01 } from '../math';
import type { MutableTimeFrame } from '../registry/types';
import {
  euclidCells,
  GRID_ACCENT,
  GRID_HIT,
  GRID_MAX_STEPS,
  GRID_OFF,
  type GridCell,
  gridParamsFromCells,
  isEuclidHit,
  timePulseInterferenceOperator,
} from '../time/operators';
import type {
  BeatSnapshot,
  LayerConfig,
  ModulationRouteConfig,
  OperatorConfig,
  ProjectDocument,
  SectionItem,
} from './types';

/**
 * Migration der alten „Wann“-Kette (Puls-Interferenz, Raster-Gravitation,
 * Euklid) auf das Rhythmus-Raster (`time-step-grid`).
 *
 * - Euklid → Bitmuster (bzw. „Zusatz-Schläge“, wenn die Schläge moduliert werden)
 * - Puls-Interferenz → abgetastet und auf das passende Raster quantisiert
 * - Raster-Gravitation entfällt (wird beim Abtasten eingerechnet)
 * - Zeit-Krümmung bleibt nur, wenn sie wirklich etwas tut
 * - Drift, Swing, Zufall bleiben unverändert
 *
 * Idempotent: Layer ohne Legacy-Rhythmus-Operatoren bleiben dieselbe Referenz.
 */

const LEGACY_RHYTHM_IDS = new Set(['time-pulse-interference', 'time-euclid', 'time-grid-gravity']);

const num = (v: number | undefined, def: number): number =>
  v === undefined || !Number.isFinite(v) ? def : v;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export const DEFAULT_GRID_PARAMS: Readonly<Record<string, number>> = {
  steps: 16,
  ...gridParamsFromCells([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  gateLen: 0.5,
  peak: 0.6,
  decay: 1,
  delay: 0,
  rotation: 0,
  accentAmt: 0.4,
  fillHits: 0,
};

/** Rhythmus-Raster-Operator (für neue Layer: Four-on-the-Floor auf 16 Steps). */
export function createStepGridOperatorConfig(
  prefix: string,
  params: Record<string, number> = {},
  bypassed = false,
): OperatorConfig {
  return {
    id: `${prefix}_time_grid`,
    moduleId: 'time-step-grid',
    version: 1,
    bypassed,
    params: { ...DEFAULT_GRID_PARAMS, ...params },
  };
}

interface SampledTrigger {
  readonly u: number;
  readonly intensity: number;
}

/** Tastet die Puls-Interferenz (inkl. Gravitation) über einen Zyklus ab. */
function sampleInterference(
  interf: OperatorConfig,
  gravity: OperatorConfig | undefined,
): SampledTrigger[] {
  const R = 7680;
  const gravOn = gravity && !gravity.bypassed && num(gravity.params.gravity, 0) > 1e-4;
  const subdiv = Math.max(1, Math.round(num(gravity?.params.subdivisions, 4)));
  const shift = num(gravity?.params.phaseShift, 0);
  const grav = num(gravity?.params.gravity, 0);
  let prev: MutableTimeFrame = {
    warpedPhase: 0,
    pulseEnergy: 0,
    triggerIntensity: 0,
    accent: 0,
    stepIndex: -1,
    pulseSlope: 0,
    gate: 0,
  };
  const out: SampledTrigger[] = [];
  const ctx = {
    beatPosition: 0,
    barPosition: 0,
    layerPhase: 0,
    cycleIndex: 0,
    cycleBeats: 4,
    beatsPerBar: 4,
    sampleRate: 48000,
  };
  // Zwei Durchläufe: der erste stellt den Flanken-Zustand ein.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < R; i++) {
      const u = i / R;
      const phase = gravOn ? wrapPhase01(gridGravityPull(u, subdiv, shift, grav)) : u;
      const inFrame: MutableTimeFrame = { ...prev, warpedPhase: phase, triggerIntensity: 0 };
      const next: MutableTimeFrame = { ...prev };
      timePulseInterferenceOperator.evaluateTimeInto!(ctx, interf.params, inFrame, next);
      if (pass === 1 && next.triggerIntensity > 0.01) out.push({ u, intensity: next.triggerIntensity });
      prev = next;
    }
  }
  return out;
}

interface GridResult {
  readonly params: Record<string, number>;
}

function interferenceToGrid(
  interf: OperatorConfig,
  gravity: OperatorConfig | undefined,
  euclidMask: OperatorConfig | undefined,
): GridResult {
  const freqA = Math.max(1, Math.min(GRID_MAX_STEPS, Math.round(num(interf.params.freqA, 4))));
  const freqB = Math.max(1, Math.round(num(interf.params.freqB, 4)));
  const mix = num(interf.params.interferenceMix, 0);
  const waveShape = num(interf.params.waveShape, 0);

  const triggers = sampleInterference(interf, gravity);
  let n = freqA;
  if (mix > 1e-4 || (gravity && !gravity.bypassed && num(gravity.params.gravity, 0) > 1e-4)) {
    const lcm = (freqA * freqB) / gcd(freqA, freqB);
    const candidates = [freqA, lcm, freqA * 2, freqA * 3, freqA * 4, 12, 16, 24, 32, 48, 64]
      .filter((c) => c >= freqA && c <= GRID_MAX_STEPS)
      .sort((a, b) => a - b);
    n = GRID_MAX_STEPS;
    for (const c of candidates) {
      const err = triggers.reduce((m, t) => Math.max(m, Math.abs(t.u * c - Math.round(t.u * c))), 0);
      if (err < 0.15) {
        n = c;
        break;
      }
    }
  }

  const cells: GridCell[] = new Array<GridCell>(n).fill(GRID_OFF);
  const intensities = new Array<number>(n).fill(0);
  for (const t of triggers) {
    const idx = Math.round(t.u * n) % n;
    intensities[idx] = Math.max(intensities[idx]!, t.intensity);
    cells[idx] = GRID_HIT;
  }
  const hitVals = intensities.filter((_, i) => cells[i] !== GRID_OFF);
  const maxI = hitVals.length > 0 ? Math.max(...hitVals) : 1;
  const minI = hitVals.length > 0 ? Math.min(...hitVals) : 1;
  let hasAccents = false;
  if (maxI - minI > 0.15) {
    for (let i = 0; i < n; i++) {
      if (cells[i] === GRID_HIT && intensities[i]! >= maxI * 0.85) {
        cells[i] = GRID_ACCENT;
        hasAccents = true;
      }
    }
  }

  // Euklid als Maske über der Interferenz: nur Schläge auf Euklid-Treffern bleiben.
  if (euclidMask) {
    const en = Math.max(1, Math.round(num(euclidMask.params.euclidSteps, 16)));
    const ek = Math.max(0, Math.min(en, Math.round(num(euclidMask.params.euclidHits, 5))));
    const erot = Math.round(num(euclidMask.params.euclidRotation, 0));
    for (let i = 0; i < n; i++) {
      const es = Math.floor((i / n) * en + 1e-9);
      if (!isEuclidHit((((es - erot) % en) + en) % en, ek, en)) cells[i] = GRID_OFF;
    }
  }

  const period = n / freqA;
  let peak = 0.35;
  let gateLen = 0.05;
  let decay = 0.75 * period;
  if (waveShape > 0.4) {
    peak = 1;
    gateLen = Math.min(1, 0.5 * period);
    decay = 0.05;
  } else if (waveShape < -0.4) {
    peak = 1;
    gateLen = 0.05;
    decay = 0.25 * period;
  }
  return {
    params: {
      ...DEFAULT_GRID_PARAMS,
      steps: n,
      ...gridParamsFromCells(cells),
      peak,
      gateLen,
      decay: Math.max(0.02, Math.min(8, decay)),
      accentAmt: hasAccents ? 0.5 : 0,
    },
  };
}

function euclidToGrid(euclid: OperatorConfig, hitsModulated: boolean): GridResult {
  const n = Math.max(1, Math.min(GRID_MAX_STEPS, Math.round(num(euclid.params.euclidSteps, 16))));
  const k = Math.max(0, Math.min(n, Math.round(num(euclid.params.euclidHits, 5))));
  const acc = num(euclid.params.euclidAccent, 0.35);
  const cells: GridCell[] = hitsModulated ? new Array<GridCell>(n).fill(GRID_OFF) : euclidCells(n, k, 0);
  if (!hitsModulated && acc > 0.05) {
    const first = cells.findIndex((c) => c !== GRID_OFF);
    if (first >= 0) cells[first] = GRID_ACCENT;
  }
  return {
    params: {
      ...DEFAULT_GRID_PARAMS,
      steps: n,
      ...gridParamsFromCells(cells),
      rotation: Math.round(num(euclid.params.euclidRotation, 0)),
      gateLen: Math.max(0.05, Math.min(1, num(euclid.params.euclidGate, 0.5))),
      peak: 1,
      decay: 0.05,
      accentAmt: Math.min(1, 0.9 * acc),
      fillHits: hitsModulated ? k : 0,
    },
  };
}

const EUCLID_PARAM_MAP: Record<string, string> = {
  euclidRotation: 'rotation',
  euclidHits: 'fillHits',
  euclidGate: 'gateLen',
  euclidAccent: 'accentAmt',
};

export function migrateLayerTime(layer: LayerConfig): LayerConfig {
  const ops = layer.timeOperators;
  if (!ops.some((o) => LEGACY_RHYTHM_IDS.has(o.moduleId))) return layer;

  const find = (id: string) => ops.find((o) => o.moduleId === id);
  const interf = find('time-pulse-interference');
  const euclid = find('time-euclid');
  const gravity = find('time-grid-gravity');
  const warp = find('time-warp');
  const interfOn = Boolean(interf && !interf.bypassed);
  const euclidOn = Boolean(euclid && !euclid.bypassed);
  const euclidMaskMode = euclidOn && Math.round(num(euclid!.params.euclidMode, 0)) === 1 && interfOn;
  const routedTo = (opId: string | undefined, paramId?: string) =>
    Boolean(
      opId &&
        layer.modulations.some(
          (m) =>
            m.enabled &&
            m.targetDomain === 'time' &&
            m.targetCardId === opId &&
            (paramId === undefined || m.targetParamId === paramId),
        ),
    );

  let gridId: string;
  let gridParams: Record<string, number>;
  let gridBypassed = false;
  let euclidBecameGrid = false;
  if (euclidOn && !euclidMaskMode) {
    gridId = euclid!.id;
    gridParams = euclidToGrid(euclid!, routedTo(euclid!.id, 'euclidHits')).params;
    euclidBecameGrid = true;
  } else if (interfOn) {
    gridId = interf!.id;
    gridParams = interferenceToGrid(interf!, gravity, euclidMaskMode ? euclid : undefined).params;
  } else {
    // Kein aktiver Rhythmus-Erzeuger: wie bisher durchgehende Energie (Dauerton).
    gridId = interf?.id ?? euclid?.id ?? `${layer.id}_time_grid`;
    gridParams = { ...DEFAULT_GRID_PARAMS };
    gridBypassed = true;
  }

  const keepWarp =
    warp !== undefined &&
    ((!warp.bypassed && Math.abs(num(warp.params.warpAmount, 0)) > 1e-3) || routedTo(warp.id));

  const gridOp: OperatorConfig = {
    id: gridId,
    moduleId: 'time-step-grid',
    version: 1,
    bypassed: gridBypassed,
    params: gridParams,
  };
  const removedIds = new Set<string>();
  for (const o of ops) {
    if (LEGACY_RHYTHM_IDS.has(o.moduleId) || (o.moduleId === 'time-warp' && !keepWarp)) removedIds.add(o.id);
  }

  const order = ['time-warp', 'time-phase-drift', 'time-swing'];
  const nextOps: OperatorConfig[] = [];
  for (const id of order) {
    const op = find(id);
    if (op && !removedIds.has(op.id)) nextOps.push(op);
  }
  nextOps.push(gridOp);
  for (const o of ops) {
    if (removedIds.has(o.id) || order.includes(o.moduleId)) continue;
    nextOps.push(o);
  }

  // Modulations-Routen umhängen bzw. entfernen.
  const droppedRoutes = new Set<string>();
  let modulations: ModulationRouteConfig[] = [];
  for (const m of layer.modulations) {
    if (m.targetDomain !== 'time' || !removedIds.has(m.targetCardId)) {
      modulations.push(m);
      continue;
    }
    if (euclidBecameGrid && euclid && m.targetCardId === euclid.id && EUCLID_PARAM_MAP[m.targetParamId]) {
      modulations.push({ ...m, targetCardId: gridId, targetParamId: EUCLID_PARAM_MAP[m.targetParamId]! });
      continue;
    }
    droppedRoutes.add(m.id);
  }
  if (droppedRoutes.size > 0) {
    modulations = modulations.filter(
      (m) => !(m.targetDomain === 'modulation' && droppedRoutes.has(m.targetCardId)),
    );
  }

  return { ...layer, timeOperators: nextOps, modulations };
}

export function migrateSnapshotTime(snapshot: BeatSnapshot): BeatSnapshot {
  let changed = false;
  const layers = snapshot.layers.map((l) => {
    const next = migrateLayerTime(l);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...snapshot, layers } : snapshot;
}

export function migrateSectionsTime(sections: readonly SectionItem[]): SectionItem[] {
  return sections.map((s) => {
    const snapshot = migrateSnapshotTime(s.snapshot);
    return snapshot === s.snapshot ? s : { ...s, snapshot };
  });
}

/** Migriert aktiven Stand, History und Abschnitte eines Projekts. */
export function migrateProjectTime(doc: ProjectDocument): ProjectDocument {
  const activeSnapshot = migrateSnapshotTime(doc.activeSnapshot);
  let changed = activeSnapshot !== doc.activeSnapshot;
  const historyNodes = doc.historyNodes.map((n) => {
    const snapshot = migrateSnapshotTime(n.snapshot);
    if (snapshot !== n.snapshot) changed = true;
    return snapshot === n.snapshot ? n : { ...n, snapshot };
  });
  const sections = doc.sections.map((s) => {
    const snapshot = migrateSnapshotTime(s.snapshot);
    if (snapshot !== s.snapshot) changed = true;
    return snapshot === s.snapshot ? s : { ...s, snapshot };
  });
  return changed ? { ...doc, activeSnapshot, historyNodes, sections } : doc;
}
