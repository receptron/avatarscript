// CTC forced alignment: the most likely path through "blank, t1, blank, t2, …, blank" given
// per-frame log-probabilities. Returns the frame span of each target.

/** Per-frame log-probabilities: score(frame, target index) and blank(frame). */
export interface Emissions {
  frames: number;
  blank(frame: number): number;
  score(frame: number, target: number): number;
}

/** The best predecessor of state s: 0 stay, 1 from s-1, 2 from s-2 (skipping a blank between different targets). */
function bestStep(prev: Float64Array, s: number, canSkip: boolean): [score: number, step: number] {
  let best = prev[s],
    step = 0;
  if (s >= 1 && prev[s - 1] > best) {
    best = prev[s - 1];
    step = 1;
  }
  if (canSkip && prev[s - 2] > best) {
    best = prev[s - 2];
    step = 2;
  }
  return [best, step];
}

/** Frame spans of the targets along the path recorded in `back`, ending in state `end`. */
function backtrack(back: Int8Array, frames: number, states: number, end: number, targetCount: number): [number, number][] {
  const spans: [number, number][] = Array.from({ length: targetCount }, () => [-1, -1]);
  let s = end;
  for (let t = frames - 1; t >= 0; t--) {
    if (s % 2 === 1) {
      const span = spans[(s - 1) / 2];
      if (span[1] < 0) span[1] = t;
      span[0] = t;
    }
    s -= back[t * states + s];
  }
  return spans;
}

/** [first frame, last frame] of each target, or null when the audio is too short for them. */
export function forcedAlign(e: Emissions, targetCount: number, sameAsPrevious: (k: number) => boolean): [number, number][] | null {
  if (targetCount === 0) return [];
  const S = 2 * targetCount + 1,
    T = e.frames;
  if (T === 0) return null;
  const emit = (t: number, s: number) => (s % 2 === 0 ? e.blank(t) : e.score(t, (s - 1) / 2));
  const canSkip = (s: number) => s >= 2 && s % 2 === 1 && !sameAsPrevious((s - 1) / 2);
  let prev = new Float64Array(S).fill(-Infinity);
  const back = new Int8Array(T * S);
  prev[0] = emit(0, 0);
  prev[1] = emit(0, 1);
  for (let t = 1; t < T; t++) {
    const cur = new Float64Array(S).fill(-Infinity);
    for (let s = 0; s < S; s++) {
      const [best, step] = bestStep(prev, s, canSkip(s));
      if (best === -Infinity) continue;
      cur[s] = best + emit(t, s);
      back[t * S + s] = step;
    }
    prev = cur;
  }
  const end = prev[S - 1] >= prev[S - 2] ? S - 1 : S - 2;
  return prev[end] === -Infinity ? null : backtrack(back, T, S, end, targetCount);
}
