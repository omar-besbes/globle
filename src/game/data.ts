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
  resolve(input: string): Country | null;
  /** Every country's border rings in one feature, for a single-mesh base map. */
  baseFeature: CountryFeature;
  /** Ranked completions for the type-ahead. */
  suggest(input: string, limit?: number): Country[];
}

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

  const { resolve, suggest } = buildMatcher(countries);

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
    distanceKm, resolve, suggest,
  };
}

type Ring = Array<[number, number]>;

export function polygonsOf(f: CountryFeature): Ring[][] {
  const g = f.geometry as { type: string; coordinates: never };
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
}

/**
 * Typo tolerance. A short word has no room for a mistake without colliding with
 * another country - Iran and Iraq are one edit apart - so the budget scales with
 * what was typed.
 */
function editBudget(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  if (len <= 11) return 2;
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
  resolve(input: string): Country | null;
  suggest(input: string, limit?: number): Country[];
}

/**
 * Turns what the player typed into a country.
 *
 * Matching runs in order of confidence: an exact alias, then a unique prefix,
 * then a near-miss within the edit budget. A fuzzy match is only accepted when
 * exactly one country is closest - "sambia" is one edit from Zambia and two from
 * Gambia so it resolves, while "ambia" ties them and is rejected rather than
 * silently guessing the wrong country.
 */
export function buildMatcher(countries: Country[]): Matcher {
  const aliasIndex = new Map<string, Country>();
  for (const c of countries) for (const a of c.aliases) if (!aliasIndex.has(a)) aliasIndex.set(a, c);
  const canonical = new Map(countries.map((c) => [c.id, normalize(c.name)]));

  // Match quality, lower is better. The ordering that matters: completing a
  // country's own name beats everything except an exact hit, a plausible typo
  // beats burrowing into the middle of some other country's official title
  // ("boliva" is Bolivia misspelt, not the start of "Bolivarian Republic of
  // Venezuela"), and a typo two edits out still beats it.
  const EXACT = 0;
  const NAME_PREFIX = 0.5;
  const ALIAS_PREFIX = 3.5;

  // A few letters shared with the front of some long official title is not
  // evidence of anything - "mata" should not land on Fiji because one of its
  // endonyms is "Matanitu Tugalala o Viti". Prefixes of an alias that is not the
  // country's own name have to be substantial to count.
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

  function rank(q: string): { best: number; winners: Country[] } {
    const budget = editBudget(q.length);
    let best = Infinity;
    let winners: Country[] = [];
    for (const c of countries) {
      const s = score(c, q, budget);
      if (s === Infinity) continue;
      if (s < best) { best = s; winners = [c]; }
      else if (s === best) winners.push(c);
    }
    return { best, winners };
  }

  /**
   * Resolves what the player typed, or nothing. A match is only accepted when a
   * single country is strictly the closest: "sambia" is one edit from Zambia and
   * two from Gambia so it resolves, while "ambia" ties them and is rejected
   * rather than silently scoring a guess against the wrong country.
   */
  function resolve(input: string): Country | null {
    const q = normalize(input);
    if (!q) return null;
    const exact = aliasIndex.get(q);
    if (exact) return exact;
    const { winners } = rank(q);
    return winners.length === 1 ? winners[0] : null;
  }

  function suggest(input: string, limit = 6): Country[] {
    const q = normalize(input);
    if (!q) return [];
    const budget = editBudget(q.length);
    const scored: Array<[Country, number]> = [];
    for (const c of countries) {
      let s = score(c, q, budget);
      // Substrings are useful for browsing the list even though they are too
      // weak to resolve a guess on their own.
      if (s === Infinity && c.aliases.some((a) => a.includes(q))) s = ALIAS_PREFIX + 1;
      if (s < Infinity) scored.push([c, s]);
    }
    scored.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name));
    return scored.slice(0, limit).map(([c]) => c);
  }

  return { resolve, suggest };
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
