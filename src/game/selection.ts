import { HINTS } from './types';
import type { Country, GameRecord } from './types';

/**
 * Per-country difficulty, learned from play history.
 *
 * Each finished game yields a difficulty in [0,1] from five signals the player
 * actually generates: how many guesses it took, how far off the opening guesses
 * were, how long it took, how many hints they took, and whether they gave up.
 * Games are combined with an exponential recency weight so recent evidence
 * dominates.
 */
export interface Weakness {
  /** 0 = easy for this player, 1 = hard. UNSEEN_PRIOR when never played. */
  score: number;
  plays: number;
  lastPlayedAt: number | null;
  solved: number;
  gaveUp: number;
  meanGuesses: number | null;
  hints: number;
}

export const UNSEEN_PRIOR = 0.55;

const RECENCY_DECAY = 0.7;   // weight of each older game relative to the next
const GUESS_FLOOR = 1;
const GUESS_CEIL = 12;
const ERROR_CEIL_KM = 8000;  // opening error at or beyond this counts as "no idea"
const TIME_FLOOR_S = 8;
const TIME_CEIL_S = 240;

const norm = (v: number, lo: number, hi: number) =>
  Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

function gameDifficulty(g: GameRecord): number {
  const guesses = Math.max(1, g.guesses.length);
  const opening = g.guesses.slice(0, 3);
  const meanOpeningError = opening.length
    ? opening.reduce((s, x) => s + x.distanceKm, 0) / opening.length
    : ERROR_CEIL_KM;
  const seconds = g.endedAt ? (g.endedAt - g.startedAt) / 1000 : TIME_CEIL_S;

  return Math.min(1,
    0.30 * norm(guesses, GUESS_FLOOR, GUESS_CEIL) +
    0.25 * norm(meanOpeningError, 0, ERROR_CEIL_KM) +
    0.15 * norm(seconds, TIME_FLOOR_S, TIME_CEIL_S) +
    0.15 * norm(g.hintsUsed ?? 0, 0, HINTS.length) +
    0.15 * (g.outcome === 'gave_up' ? 1 : 0));
}

export function weaknessByCountry(games: GameRecord[]): Map<string, Weakness> {
  const grouped = new Map<string, GameRecord[]>();
  for (const g of games) {
    if (g.outcome !== 'solved' && g.outcome !== 'gave_up') continue;
    (grouped.get(g.targetId) ?? grouped.set(g.targetId, []).get(g.targetId)!).push(g);
  }

  const out = new Map<string, Weakness>();
  for (const [id, list] of grouped) {
    list.sort((a, b) => b.startedAt - a.startedAt); // newest first
    let weighted = 0;
    let total = 0;
    list.forEach((g, i) => {
      const w = RECENCY_DECAY ** i;
      weighted += w * gameDifficulty(g);
      total += w;
    });
    out.set(id, {
      score: total ? weighted / total : UNSEEN_PRIOR,
      plays: list.length,
      lastPlayedAt: list[0].startedAt,
      solved: list.filter((g) => g.outcome === 'solved').length,
      gaveUp: list.filter((g) => g.outcome === 'gave_up').length,
      meanGuesses: list.reduce((s, g) => s + g.guesses.length, 0) / list.length,
      hints: list.reduce((s, g) => s + (g.hintsUsed ?? 0), 0),
    });
  }
  return out;
}

export function weaknessFor(id: string, map: Map<string, Weakness>): Weakness {
  return map.get(id) ?? {
    score: UNSEEN_PRIOR, plays: 0, lastPlayedAt: null,
    solved: 0, gaveUp: 0, meanGuesses: null, hints: 0,
  };
}

/**
 * Sampling weight. Hard countries are favoured quadratically, and anything not
 * seen for a while gets a lift so the rotation does not collapse onto a handful
 * of countries the player keeps failing.
 */
export function samplingWeight(w: Weakness, now: number): number {
  const days = w.lastPlayedAt === null ? 30 : (now - w.lastPlayedAt) / 86_400_000;
  const staleness = 1 + Math.min(1, days / 21);
  return (0.15 + w.score) ** 2 * staleness;
}

export interface PickOptions {
  pool: Country[];
  games: GameRecord[];
  strategy: 'adaptive' | 'random';
  /** Avoid immediately repeating a target unless the pool is tiny. */
  recentTargets?: string[];
  random?: () => number;
}

export function pickTarget({ pool, games, strategy, recentTargets = [], random = Math.random }: PickOptions): Country | null {
  if (pool.length === 0) return null;

  const avoid = new Set(recentTargets.slice(-Math.floor(pool.length / 2)));
  const candidates = pool.filter((c) => !avoid.has(c.id));
  const usable = candidates.length ? candidates : pool;

  if (strategy === 'random') return usable[Math.floor(random() * usable.length)];

  const weakness = weaknessByCountry(games);
  const now = Date.now();
  const weights = usable.map((c) => samplingWeight(weaknessFor(c.id, weakness), now));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return usable[Math.floor(random() * usable.length)];

  let r = random() * total;
  for (let i = 0; i < usable.length; i++) {
    r -= weights[i];
    if (r <= 0) return usable[i];
  }
  return usable[usable.length - 1];
}
