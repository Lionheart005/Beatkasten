/**
 * Baut den Demo-Song „Nachtschicht“ als echten Projektordner und rendert ihn.
 *
 *   npx vite-node scripts/build-demo-song.ts            → Projekt + WAV schreiben
 *   npx vite-node scripts/build-demo-song.ts --analyze  → nur Mix-Analyse (schnell)
 *
 * Ziel: BeispielSetups/Projekte/Projekte/Nachtschicht/ (gleiches Format wie die App).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderOfflineLoop, renderSongChain } from '../src/core/engine';
import { encodeMp3, encodeWav } from '../src/core/export';
import { createNachtschichtProject } from '../src/core/state';
import { sanitizeStorageName } from '../src/storage/ProjectStorageAdapter';

const analyzeOnly = process.argv.includes('--analyze');
const project = createNachtschichtProject();

function measure(left: Float32Array, right: Float32Array, sr: number) {
  // grobe Bänder: < 150 Hz, 150 Hz – 5 kHz, > 5 kHz (One-Pole-Filter)
  const aLow = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  const aHigh = 1 - Math.exp((-2 * Math.PI * 5000) / sr);
  let lp1 = 0;
  let lp2 = 0;
  let peak = 0;
  let sum = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  let side = 0;
  let clip = 0;
  for (let i = 0; i < left.length; i++) {
    const l = left[i]!;
    const r = right[i]!;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    lp1 += aLow * (m - lp1);
    lp2 += aHigh * (m - lp2);
    const lo = lp1;
    const hi = m - lp2;
    const mi = m - lo - hi;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    if (Math.abs(l) > 0.99 || Math.abs(r) > 0.99) clip++;
    sum += m * m;
    low += lo * lo;
    mid += mi * mi;
    high += hi * hi;
    side += s * s;
  }
  const n = Math.max(1, left.length);
  const db = (x: number) => (x > 0 ? (10 * Math.log10(x / n)).toFixed(1) : '-inf');
  return {
    peak: peak.toFixed(3),
    rmsDb: db(sum),
    lowDb: db(low),
    midDb: db(mid),
    highDb: db(high),
    sideDb: db(side),
    clipPct: ((clip / n) * 100).toFixed(3),
  };
}

// 1) Pegel pro Layer im Peak- und Break-Abschnitt (isoliert gerendert)
for (const secIdx of [2, 3]) {
  const sec = project.sections[secIdx]!;
  console.log(`\n=== Layer-Pegel: ${sec.name} (8 Takte, 24 kHz) ===`);
  const sr = 24000;
  const mix = renderOfflineLoop(sec.snapshot, { bars: 8, preRollBars: 1, sampleRate: sr });
  console.log('MIX'.padEnd(28), JSON.stringify(measure(mix.left, mix.right, sr)));
  for (const layer of sec.snapshot.layers) {
    if (layer.muted) continue;
    const stem = renderOfflineLoop(sec.snapshot, {
      bars: 8,
      preRollBars: 1,
      sampleRate: sr,
      isolateLayerId: layer.id,
    });
    console.log(layer.name.padEnd(28), JSON.stringify(measure(stem.left, stem.right, sr)));
  }
}

// 2) Ganze Song-Kette
const sr = analyzeOnly ? 24000 : 48000;
const t0 = Date.now();
const song = renderSongChain(
  project.sections.map((s) => ({ snapshot: s.snapshot, bars: s.exportBars, name: s.name })),
  { sampleRate: sr, preRollBars: 2, tailBars: 2 },
);
console.log(`\n=== Song-Kette: ${song.durationSeconds.toFixed(1)} s, gerendert in ${Date.now() - t0} ms ===`);
project.sections.forEach((s, i) => {
  const a = song.partStartSamples[i]!;
  const b = song.partStartSamples[i + 1] ?? song.numSamples;
  console.log(s.name.padEnd(14), JSON.stringify(measure(song.left.subarray(a, b), song.right.subarray(a, b), sr)));
});
console.log('GESAMT'.padEnd(14), JSON.stringify(measure(song.left, song.right, sr)));

if (!analyzeOnly) {
  const root = join('BeispielSetups', 'Projekte', 'Projekte', sanitizeStorageName(project.name, project.id));
  mkdirSync(join(root, 'sections'), { recursive: true });
  mkdirSync(join(root, 'exports'), { recursive: true });
  const manifest = {
    id: project.id,
    name: project.name,
    version: project.version,
    updatedAt: project.updatedAt,
    activeSnapshot: project.activeSnapshot,
    activeHistoryNodeId: project.activeHistoryNodeId,
  };
  writeFileSync(join(root, 'project.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(root, 'history.json'), JSON.stringify(project.historyNodes, null, 2));
  project.sections.forEach((s, i) => {
    const file = `${String(i + 1).padStart(2, '0')}_${sanitizeStorageName(s.name, s.id)}.json`;
    writeFileSync(join(root, 'sections', file), JSON.stringify(s, null, 2));
  });
  writeFileSync(join(root, 'exports', 'Nachtschicht_song.wav'), encodeWav(song.left, song.right, sr, 24));
  writeFileSync(join(root, 'exports', 'Nachtschicht_song.mp3'), encodeMp3(song.left, song.right, sr, 320));
  console.log(`\nProjekt geschrieben nach ${root}`);
}
