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
  /** Country under a lat/lng, or null over water. */
  locate(lat: number, lng: number): Country | null;
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

  const aliasIndex = new Map<string, Country>();
  for (const c of countries) for (const a of c.aliases) if (!aliasIndex.has(a)) aliasIndex.set(a, c);

  function resolve(input: string): Country | null {
    const q = normalize(input);
    if (!q) return null;
    const exact = aliasIndex.get(q);
    if (exact) return exact;
    // Unique prefix match, so "united arab" resolves but "united" stays ambiguous.
    const hits = countries.filter((c) => c.aliases.some((a) => a.startsWith(q)));
    const unique = new Set(hits.map((c) => c.id));
    return unique.size === 1 ? hits[0] : null;
  }

  function suggest(input: string, limit = 6): Country[] {
    const q = normalize(input);
    if (!q) return [];
    const scored: Array<[Country, number]> = [];
    for (const c of countries) {
      let best = Infinity;
      for (const a of c.aliases) {
        if (a === q) best = Math.min(best, 0);
        else if (a.startsWith(q)) best = Math.min(best, 1);
        else if (a.includes(q)) best = Math.min(best, 2);
      }
      // Prefer the canonical name over an obscure alias at the same match quality.
      if (best < Infinity) scored.push([c, best * 10 + (normalize(c.name).startsWith(q) ? 0 : 1)]);
    }
    scored.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name));
    return scored.slice(0, limit).map(([c]) => c);
  }

  const features = geo.features.filter((f) => byId.has(f.properties.id));

  const locate = buildLocator(features, byId);

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
    distanceKm, resolve, suggest, locate,
  };
}

type Ring = Array<[number, number]>;

export function polygonsOf(f: CountryFeature): Ring[][] {
  const g = f.geometry as { type: string; coordinates: never };
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
}

/** A click this far outside a coastline still counts as hitting that country. */
const COAST_TOLERANCE_KM = 260;

/**
 * Resolves a lat/lng to a country. Bounding boxes cut the work to a handful of
 * ring tests, which keeps a click on the globe cheap enough to run inline.
 *
 * Render geometry is heavily simplified, so coastlines sit inland of where they
 * really are and a click on Sydney or Manhattan lands in the sea. When no
 * polygon contains the point we fall back to the nearest coastline within a
 * tolerance, and only call it open water beyond that.
 */
export function buildLocator(
  features: CountryFeature[],
  byId: Map<string, Country>,
): (lat: number, lng: number) => Country | null {
  const boxes = features.map((f) => {
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    for (const poly of polygonsOf(f)) for (const [lng, lat] of poly[0]) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { f, minLng, minLat, maxLng, maxLat };
  });

  // Flat vertex list for the coastline fallback.
  const vLng: number[] = [];
  const vLat: number[] = [];
  const vOwner: string[] = [];
  for (const f of features) {
    for (const poly of polygonsOf(f)) for (const ring of poly) for (const [lng, lat] of ring) {
      vLng.push(lng); vLat.push(lat); vOwner.push(f.properties.id);
    }
  }

  return (lat, lng) => {
    for (const b of boxes) {
      if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) continue;
      for (const poly of polygonsOf(b.f)) {
        // The outer ring must contain the point and no hole may exclude it.
        if (!pointInRing(lng, lat, poly[0])) continue;
        if (poly.slice(1).some((hole) => pointInRing(lng, lat, hole))) continue;
        return byId.get(b.f.properties.id) ?? null;
      }
    }

    const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
    const limit = COAST_TOLERANCE_KM ** 2;
    let best = Infinity;
    let owner: string | null = null;
    for (let i = 0; i < vLng.length; i++) {
      let dLng = vLng[i] - lng;
      if (dLng > 180) dLng -= 360; else if (dLng < -180) dLng += 360;
      const dx = dLng * kmPerDegLng;
      const dy = (vLat[i] - lat) * 110.57;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; owner = vOwner[i]; }
    }
    return best <= limit && owner ? byId.get(owner) ?? null : null;
  };
}

/** Standard even-odd ray casting in lng/lat space. */
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
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
