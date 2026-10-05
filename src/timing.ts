// Corrects provider character timing against the audio itself. Providers can be off by a few
// hundred milliseconds (ElevenLabs v3 after an emotion tag starts late), which is very visible
// on a mouth. Voice onset/offset and the silences at punctuation are measured in the audio and
// the character timeline is stretched piecewise between them.
import type { CharTime } from "./g2p/types.ts";

const FRAME = 0.01; // analysis step, seconds
const MIN_GAP = 0.08; // shortest silence that counts as a pause
const SEARCH = 0.35; // how far a pause may be from where the provider put it

export const isSpoken = (c: string) => !/[\s\p{P}\p{S}]/u.test(c);

/** Silent stretches of the audio, [start, end] in seconds (including the edges). */
export function silences(samples: Float32Array, sampleRate: number): { gaps: [number, number][]; onset: number; offset: number } | null {
  const hop = Math.round(sampleRate * FRAME),
    n = Math.floor(samples.length / hop);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < hop; k++) s += samples[i * hop + k] ** 2;
    db[i] = 10 * Math.log10(s / hop + 1e-12);
  }
  const peak = Math.max(...db);
  const threshold = Math.max(-50, peak - 35);
  const loud = Array.from(db, (v) => v > threshold);
  const first = loud.indexOf(true),
    last = loud.lastIndexOf(true);
  if (first < 0) return null;
  const gaps: [number, number][] = [];
  let start = -1;
  for (let i = first; i <= last; i++) {
    if (!loud[i] && start < 0) start = i;
    if (loud[i] && start >= 0) {
      if ((i - start) * FRAME >= MIN_GAP) gaps.push([start * FRAME, i * FRAME]);
      start = -1;
    }
  }
  return { gaps, onset: first * FRAME, offset: (last + 1) * FRAME };
}

/** Maps provider times onto the audio: piecewise linear through matched anchors. */
export function refineTiming(chars: string[], timing: CharTime[], samples: Float32Array, sampleRate: number): CharTime[] {
  const spoken = chars.flatMap((c, i) => (isSpoken(c) ? [i] : []));
  const audio = silences(samples, sampleRate);
  if (!audio || !spoken.length) return timing;
  const anchors: [from: number, to: number][] = [[timing[spoken[0]].start, audio.onset]];
  const used = new Set<number>();
  // each run of unspoken characters between two spoken ones may sit on a silence
  for (let k = 0; k + 1 < spoken.length; k++) {
    const a = spoken[k],
      b = spoken[k + 1];
    if (b === a + 1) continue;
    const ps = timing[a].end,
      pe = timing[b].start;
    let best = -1,
      bestDist = Infinity;
    audio.gaps.forEach(([gs, ge], g) => {
      if (used.has(g) || ge < ps - SEARCH || gs > pe + SEARCH) return;
      const dist = Math.abs((gs + ge) / 2 - (ps + pe) / 2);
      if (dist < bestDist) {
        best = g;
        bestDist = dist;
      }
    });
    if (best < 0) continue;
    const [gs, ge] = audio.gaps[best];
    const prev = anchors[anchors.length - 1];
    if (ps <= prev[0] || gs <= prev[1]) continue; // keep the mapping increasing
    used.add(best);
    anchors.push([ps, gs], [Math.max(pe, ps + 1e-3), ge]);
  }
  const end = timing[spoken[spoken.length - 1]].end,
    prev = anchors[anchors.length - 1];
  if (end > prev[0] && audio.offset > prev[1]) anchors.push([end, audio.offset]);

  const map = (t: number) => {
    if (anchors.length === 1 || t <= anchors[0][0]) return t + anchors[0][1] - anchors[0][0];
    for (let i = 1; i < anchors.length; i++) {
      const [x0, y0] = anchors[i - 1],
        [x1, y1] = anchors[i];
      if (t <= x1) return y0 + ((t - x0) * (y1 - y0)) / (x1 - x0);
    }
    const [x, y] = anchors[anchors.length - 1];
    return t + y - x;
  };
  return timing.map(({ start, end }) => {
    const s = Math.max(0, map(start));
    return { start: s, end: Math.max(s, map(end)) };
  });
}
