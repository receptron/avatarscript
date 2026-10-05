// The canonical viseme set (Oculus/Meta 15 visemes) and the mapping down to what an avatar
// can show.

export const VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'] as const;
export type Viseme = typeof VISEMES[number];

/** A viseme starting at `t` seconds, lasting until the next one. */
export type VisemeEvent = [t: number, viseme: Viseme];

export const isViseme = (v: string): v is Viseme => (VISEMES as readonly string[]).includes(v);

export const VOWEL_VISEMES: ReadonlySet<Viseme> = new Set(['aa', 'E', 'ih', 'oh', 'ou']);

/** Mouth keys of the mesh engine's `holdMouth()`: five vowels and `n` (closed, keeps the shape). */
export type MeshMouth = 'a' | 'i' | 'u' | 'e' | 'o' | 'n';

// Tier 0/1 mapping for the mesh engine. Consonants are short: closing the mouth for them gives
// the beat between syllables (the engine's smoothing turns a brief close into a partial one),
// while the rounded ones keep the lips rounded.
export const MESH_MOUTH: Record<Viseme, MeshMouth> = {
  sil: 'n', PP: 'n', FF: 'n', TH: 'n', DD: 'n', kk: 'n', SS: 'n', nn: 'n',
  CH: 'u', RR: 'u',
  aa: 'a', E: 'e', ih: 'i', oh: 'o', ou: 'u',
};

/** Merges repeated visemes and orders the events by time. */
export function normalizeEvents(events: VisemeEvent[]): VisemeEvent[] {
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  const out: VisemeEvent[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && last[0] === e[0]) { out[out.length - 1] = e; continue; }
    if (last && last[1] === e[1]) continue;
    out.push([Math.round(e[0] * 1000) / 1000, e[1]]);
  }
  return out;
}

/** The viseme active at time t. */
export function visemeAt(events: VisemeEvent[], t: number): Viseme {
  let lo = 0, hi = events.length - 1, found: Viseme = 'sil';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid][0] <= t) { found = events[mid][1]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
