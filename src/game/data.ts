import type { Country } from './types';

export interface CountryFeature {
  type: 'Feature';
  id: string;
  properties: { id: string };
  geometry: GeoJSON.Geometry;
}

export interface DataPack {
  countries: Country[];
  byId: Map<string, Country>;
  /** Order matters: it indexes into the distance matrix. */
  index: Map<string, number>;
  features: CountryFeature[];
  maxDistanceKm: number;
  distanceKm(a: string, b: string): number;
  match(input: string): MatchResult;
  /** Every country's border rings in one feature, for a single-mesh base map. */
  baseFeature: CountryFeature;
}

/**
 * What the player typed resolved into one of three outcomes.
 *
 * `exact` is taken as the guess without asking. `suggest` is a near miss the
 * player has to confirm, so a misspelling never silently scores against a
 * country they did not mean. `none` is text that resembles nothing.
 */
export type MatchResult =
  | { kind: 'exact'; country: Country }
  | { kind: 'suggest'; candidates: Country[] }
  | { kind: 'none' };

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

interface CountriesPayload {
  version: number;
  maxDistanceKm: number;
  countries: Country[];
}

/** Present only in the single-file build, where there is nothing to fetch. */
interface InlinedPack {
  countries: CountriesPayload;
  geometry: { features: CountryFeature[] };
  distBase64: string;
}

async function fetchPack(): Promise<[CountriesPayload, ArrayBuffer, { features: CountryFeature[] }]> {
  const inlined = (globalThis as { __GLOBLE_DATA__?: InlinedPack }).__GLOBLE_DATA__;
  if (inlined) {
    const bin = Uint8Array.from(atob(inlined.distBase64), (c) => c.charCodeAt(0));
    return [inlined.countries, bin.buffer, inlined.geometry];
  }
  const base = import.meta.env.BASE_URL;
  return Promise.all([
    fetch(`${base}data/countries.json`).then((r) => r.json() as Promise<CountriesPayload>),
    fetch(`${base}data/dist.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}data/geometry.json`).then(
      (r) => r.json() as Promise<{ features: CountryFeature[] }>),
  ]);
}

export async function loadData(): Promise<DataPack> {
  const [meta, distBuf, geo] = await fetchPack();

  const countries: Country[] = meta.countries;
  const n = countries.length;
  const dist = new Uint16Array(distBuf);
  const index = new Map(countries.map((c, i) => [c.id, i]));
  const byId = new Map(countries.map((c) => [c.id, c]));

  // Upper-triangular offset for (i < j).
  const at = (i: number, j: number) => (i * (2 * n - i - 1)) / 2 + (j - i - 1);

  function distanceKm(a: string, b: string): number {
    if (a === b) return 0;
    let i = index.get(a)!;
    let j = index.get(b)!;
    if (i > j) [i, j] = [j, i];
    return dist[at(i, j)];
  }

  const { match } = buildMatcher(countries);

  const features = geo.features.filter((f) => byId.has(f.properties.id));

  const baseFeature: CountryFeature = {
    type: 'Feature',
    id: '__base',
    properties: { id: '__base' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: features.flatMap(polygonsOf) as never,
    },
  };

  return {
    countries, byId, index, features, baseFeature,
    maxDistanceKm: meta.maxDistanceKm,
    distanceKm, match,
  };
}

type Ring = Array<[number, number]>;

export function polygonsOf(f: CountryFeature): Ring[][] {
  const g = f.geometry as { type: string; coordinates: never };
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
}

/**
 * Typo tolerance, scaled to what was typed. A near miss is only ever offered as
 * a suggestion the player confirms, never accepted outright, so this can be
 * generous: proposing Iran when someone meant Iraq costs a glance, not a guess.
 */
function editBudget(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  if (len <= 10) return 2;
  return 3;
}

/**
 * Optimal string alignment distance: Levenshtein plus adjacent transpositions,
 * so "untied states" costs one edit rather than two. Bails out early once the
 * row minimum exceeds the budget.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr: number[] = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = curr;
    curr = new Array(b.length + 1);
  }
  return prev[b.length];
}

export interface Matcher {
  match(input: string): MatchResult;
}

/** Most suggestions are a single country; ties show a short list instead. */
const MAX_SUGGESTIONS = 2;

export function buildMatcher(countries: Country[]): Matcher {
  const aliasIndex = new Map<string, Country>();
  for (const c of countries) for (const a of c.aliases) if (!aliasIndex.has(a)) aliasIndex.set(a, c);
  const canonical = new Map(countries.map((c) => [c.id, normalize(c.name)]));

  // Match quality, lower is better. Completing a name and misspelling one are
  // different kinds of evidence, not just different amounts: the prefix tiers
  // are taken as deliberate, the edit-distance tiers in between are treated as
  // guesses about what was meant.
  const EXACT = 0;
  const NAME_PREFIX = 0.5;
  const ALIAS_PREFIX = 3.5;
  const isDeliberate = (s: number) =>
    s === EXACT || s === NAME_PREFIX || s === ALIAS_PREFIX;

  // A few letters shared with the front of some long official title is not
  // evidence of anything - "mata" should not reach Fiji because one of its
  // endonyms is "Matanitu Tugalala o Viti".
  const prefixCounts = (q: string, alias: string) => q.length >= 4 && q.length * 2 >= alias.length;

  function score(c: Country, q: string, budget: number): number {
    let best = Infinity;
    const name = canonical.get(c.id)!;
    for (const a of c.aliases) {
      if (a === q) return EXACT;
      if (!a.startsWith(q)) continue;
      if (a === name) best = Math.min(best, NAME_PREFIX);
      else if (prefixCounts(q, a)) best = Math.min(best, ALIAS_PREFIX);
    }
    if (budget > 0) {
      for (const a of c.aliases) {
        if (Math.abs(a.length - q.length) > budget) continue;
        const d = editDistance(q, a, budget);
        if (d <= budget) best = Math.min(best, d);
      }
    }
    return best;
  }

  function match(input: string): MatchResult {
    const q = normalize(input);
    if (!q) return { kind: 'none' };

    const exact = aliasIndex.get(q);
    if (exact) return { kind: 'exact', country: exact };

    const budget = editBudget(q.length);
    let best = Infinity;
    let winners: Country[] = [];
    for (const c of countries) {
      const s = score(c, q, budget);
      if (s === Infinity) continue;
      if (s < best) { best = s; winners = [c]; }
      else if (s === best) winners.push(c);
    }
    if (winners.length === 0) return { kind: 'none' };

    // One country, reached by completing a name it actually has: take it.
    if (winners.length === 1 && isDeliberate(best)) {
      return { kind: 'exact', country: winners[0] };
    }

    winners.sort((a, b) => {
      const aStarts = canonical.get(a.id)!.startsWith(q) ? 0 : 1;
      const bStarts = canonical.get(b.id)!.startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    });
    return { kind: 'suggest', candidates: winners.slice(0, MAX_SUGGESTIONS) };
  }

  return { match };
}

/** Subregions grouped by continent, for the scope picker. */
export function scopeTree(countries: Country[]): Array<{ region: string; subregions: string[] }> {
  const map = new Map<string, Set<string>>();
  for (const c of countries) {
    if (!c.playable) continue;
    (map.get(c.region) ?? map.set(c.region, new Set()).get(c.region)!).add(c.subregion);
  }
  return [...map]
    .map(([region, subs]) => ({ region, subregions: [...subs].sort() }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

/** Countries eligible to be the answer under the given scope. */
export function poolFor(countries: Country[], scope: string[]): Country[] {
  const set = new Set(scope);
  return countries.filter((c) => c.playable && (set.size === 0 || set.has(c.subregion)));
}
