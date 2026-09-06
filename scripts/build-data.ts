/**
 * Build-time data pipeline.
 *
 * Emits three files into public/data:
 *   countries.json     metadata + canonical ordering (the "index" every other file keys off)
 *   dist.bin           Uint16 upper-triangular matrix of border-to-border distances, km
 *   geometry.topo.json trimmed TopoJSON, ids rewritten to our canonical ids
 *
 * Distance is minimum distance between country borders (not centroids) because that
 * is what makes hot/cold feel right. Land-adjacent pairs are pinned to 0.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature, quantize } from 'topojson-client';
import { presimplify, quantile, simplify } from 'topojson-simplify';
import type { Topology, GeometryCollection } from 'topojson-specification';

const require = createRequire(import.meta.url);
const OUT = new URL('../public/data/', import.meta.url);

if (process.argv.includes('--if-missing') && existsSync(new URL('dist.bin', OUT))) {
  console.log('[data] up to date, skipping');
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const R = 6371.0088; // mean Earth radius, km

// ---------------------------------------------------------------- source data

const topo = require('world-atlas/countries-50m.json') as Topology<{
  countries: GeometryCollection<{ name: string }>;
}>;
const worldCountries = require('world-countries/countries.json') as WorldCountry[];

interface WorldCountry {
  name: { common: string; official: string };
  cca2: string;
  ccn3: string;
  cca3: string;
  independent: boolean;
  unMember: boolean;
  region: string;
  subregion: string;
  borders: string[];
  altSpellings: string[];
  latlng: [number, number];
  capital: string[];
}

/** Features world-atlas ships without an ISO numeric id. */
const UNMATCHED: Record<string, Partial<Meta> | null> = {
  Kosovo: {
    id: 'XKX', name: 'Kosovo', iso2: 'XK', iso3: 'XKX',
    region: 'Europe', subregion: 'Southeast Europe', playable: false, disputed: true,
  },
  Somaliland: {
    id: 'XSO', name: 'Somaliland', iso2: '', iso3: '',
    region: 'Africa', subregion: 'Eastern Africa', playable: false, disputed: true,
  },
  'N. Cyprus': {
    id: 'XNC', name: 'Northern Cyprus', iso2: '', iso3: '',
    region: 'Asia', subregion: 'Western Asia', playable: false, disputed: true,
  },
  // Uninhabited / not meaningful as guesses.
  'Indian Ocean Ter.': null,
  'Siachen Glacier': null,
};

/** Names people actually type that the source data does not already cover. */
const EXTRA_ALIASES: Record<string, string[]> = {
  MMR: ['burma'],
  NLD: ['holland'],
  GBR: ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales', 'northern ireland'],
  USA: ['us', 'usa', 'america', 'united states'],
  ARE: ['uae', 'emirates'],
  COD: ['drc', 'dr congo', 'congo kinshasa', 'zaire'],
  COG: ['congo brazzaville', 'republic of the congo'],
  CIV: ['ivory coast'],
  KOR: ['south korea'],
  PRK: ['north korea'],
  CZE: ['czech republic', 'czechia'],
  SWZ: ['swaziland'],
  CPV: ['cape verde'],
  TLS: ['east timor'],
  VAT: ['vatican', 'holy see'],
  MKD: ['macedonia'],
  TUR: ['turkey', 'turkiye'],
  RUS: ['russia'],
  BOL: ['bolivia'],
  VEN: ['venezuela'],
  TZA: ['tanzania'],
  IRN: ['iran'],
  SYR: ['syria'],
  LAO: ['laos'],
  BRN: ['brunei'],
  MDA: ['moldova'],
  PSE: ['palestine'],
  CAF: ['central african republic', 'car'],
  DOM: ['dominican republic'],
  GNQ: ['equatorial guinea'],
  PNG: ['papua new guinea'],
  ZAF: ['south africa', 'rsa'],
  SSD: ['south sudan'],
  BIH: ['bosnia'],
  ATA: ['antarctica'],
};

// world-countries uses UN M49 subregions; these read better as game filters.
const SUBREGION_RENAME: Record<string, string> = {
  'South-Eastern Asia': 'Southeast Asia',
  'Australia and New Zealand': 'Australasia',
};

// ---------------------------------------------------------------------- meta

interface Meta {
  id: string;
  name: string;
  iso2: string;
  iso3: string;
  region: string;
  subregion: string;
  playable: boolean;
  territory: boolean;
  disputed: boolean;
  lat: number;
  lng: number;
  aliases: string[];
}

const byCcn3 = new Map(worldCountries.map((c) => [c.ccn3, c]));
const fc = feature(topo, topo.objects.countries) as unknown as {
  features: Array<{ id?: string; properties: { name: string }; geometry: any }>;
};

const metas: Meta[] = [];
const geometries: Array<{ id: string; geometry: any }> = [];
const metaIndex = new Map<string, number>();

const asPolygons = (g: any): any[] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

for (const f of fc.features) {
  if (!f.geometry) continue;
  const src = f.id ? byCcn3.get(f.id) : undefined;
  let meta: Meta;

  if (src) {
    const subregion = SUBREGION_RENAME[src.subregion] ?? src.subregion;
    meta = {
      id: src.cca3,
      name: src.name.common,
      iso2: src.cca2,
      iso3: src.cca3,
      region: src.region || 'Other',
      subregion: subregion || src.region || 'Other',
      // Answers are UN members. Territories and disputed areas stay guessable
      // but are never the target, which keeps the answer pool defensible.
      playable: src.unMember,
      territory: !src.independent,
      disputed: false,
      lat: src.latlng[0],
      lng: src.latlng[1],
      aliases: [],
    };
  } else {
    const patch = UNMATCHED[f.properties.name];
    if (patch === null || patch === undefined) continue;
    meta = {
      territory: false, disputed: false, lat: 0, lng: 0, aliases: [],
      playable: false, region: 'Other', subregion: 'Other',
      ...patch,
    } as Meta;
  }
  // Natural Earth tags some dependencies with their parent's ISO number
  // (Ashmore and Cartier Islands carry Australia's). Fold them into the parent
  // instead of creating a second country with the same id.
  const existing = metaIndex.get(meta.id);
  if (existing !== undefined) {
    geometries[existing].geometry = {
      type: 'MultiPolygon',
      coordinates: [...asPolygons(geometries[existing].geometry), ...asPolygons(f.geometry)],
    };
    continue;
  }
  metaIndex.set(meta.id, metas.length);
  metas.push(meta);
  geometries.push({ id: meta.id, geometry: f.geometry });
}

// Antarctica is geometry, not a country anyone should be asked to guess.
for (const m of metas) if (m.id === 'ATA') { m.playable = false; m.region = 'Antarctic'; m.subregion = 'Antarctic'; }

// ------------------------------------------------------------------- aliases

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

for (const m of metas) {
  const src = m.iso3 ? worldCountries.find((c) => c.cca3 === m.iso3) : undefined;
  const raw = new Set<string>([m.name]);
  if (src) {
    raw.add(src.name.official);
    for (const a of src.altSpellings) raw.add(a);
    raw.add(src.cca2);
    raw.add(src.cca3);
  }
  for (const a of EXTRA_ALIASES[m.id] ?? []) raw.add(a);
  const seen = new Set<string>();
  m.aliases = [...raw]
    .map(norm)
    .filter((a) => a.length >= 2 && !seen.has(a) && (seen.add(a), true));
}

// Ambiguity guard: an alias claimed by more than one country is dropped, unless
// it is one country's own name - "Australia" belongs to Australia even though a
// territory lists it as an alternate spelling.
const aliasOwners = new Map<string, string[]>();
for (const m of metas) for (const a of m.aliases) {
  (aliasOwners.get(a) ?? aliasOwners.set(a, []).get(a)!).push(m.id);
}
const ambiguous = new Set([...aliasOwners].filter(([, ids]) => ids.length > 1).map(([a]) => a));
for (const m of metas) m.aliases = m.aliases.filter((a) => !ambiguous.has(a) || norm(m.name) === a);

// ----------------------------------------------------------------- distances

/** Unit sphere vectors, thinned onto a ~15km grid so the O(n*m) inner loop stays cheap. */
const THIN_KM = 15;
function toVectors(geometry: any): Float64Array {
  const cell = new Map<string, [number, number, number]>();
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const step = (THIN_KM / R) * (180 / Math.PI); // degrees of latitude per cell
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        // Widen cells toward the poles so thinning is roughly isotropic in km.
        const lonStep = step / Math.max(0.02, Math.cos((lat * Math.PI) / 180));
        const key = `${Math.round(lat / step)}:${Math.round(lng / lonStep)}`;
        if (cell.has(key)) continue;
        const p = (lat * Math.PI) / 180;
        const l = (lng * Math.PI) / 180;
        cell.set(key, [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]);
      }
    }
  }
  const out = new Float64Array(cell.size * 3);
  let i = 0;
  for (const v of cell.values()) { out[i++] = v[0]; out[i++] = v[1]; out[i++] = v[2]; }
  return out;
}

/** Split a vertex set into coarse clusters, each with a bounding cap, for pair pruning. */
interface Cluster { c: [number, number, number]; r: number; from: number; to: number }
function cluster(v: Float64Array): { v: Float64Array; clusters: Cluster[] } {
  const n = v.length / 3;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    const key = `${Math.round(x * 4)}:${Math.round(y * 4)}:${Math.round(z * 4)}`;
    const b = buckets.get(key); if (b) b.push(i); else buckets.set(key, [i]);
  }
  const sorted = new Float64Array(v.length);
  const clusters: Cluster[] = [];
  let w = 0;
  for (const idxs of buckets.values()) {
    const from = w / 3;
    let cx = 0, cy = 0, cz = 0;
    for (const i of idxs) {
      sorted[w++] = v[i * 3]; sorted[w++] = v[i * 3 + 1]; sorted[w++] = v[i * 3 + 2];
      cx += v[i * 3]; cy += v[i * 3 + 1]; cz += v[i * 3 + 2];
    }
    const len = Math.hypot(cx, cy, cz) || 1;
    const c: [number, number, number] = [cx / len, cy / len, cz / len];
    let r = 0;
    for (const i of idxs) {
      const d = c[0] * v[i * 3] + c[1] * v[i * 3 + 1] + c[2] * v[i * 3 + 2];
      r = Math.max(r, Math.acos(Math.min(1, Math.max(-1, d))));
    }
    clusters.push({ c, r, from, to: w / 3 });
  }
  return { v: sorted, clusters };
}

const shapes = geometries.map((g) => cluster(toVectors(g.geometry)));
const n = metas.length;
const idx = new Map(metas.map((m, i) => [m.id, i]));

// Land borders come from the source data and are authoritative: pin them to 0.
const adjacent = new Set<number>();
for (const m of metas) {
  const src = m.iso3 ? worldCountries.find((c) => c.cca3 === m.iso3) : undefined;
  if (!src) continue;
  const i = idx.get(m.id)!;
  for (const b of src.borders) {
    const j = idx.get(b);
    if (j !== undefined) adjacent.add(i < j ? i * n + j : j * n + i);
  }
}

const dist = new Uint16Array((n * (n - 1)) / 2);
const at = (i: number, j: number) => (i * (2 * n - i - 1)) / 2 + (j - i - 1);

const t0 = Date.now();
for (let i = 0; i < n; i++) {
  const A = shapes[i];
  for (let j = i + 1; j < n; j++) {
    if (adjacent.has(i * n + j)) { dist[at(i, j)] = 0; continue; }
    const B = shapes[j];
    let best = Infinity; // squared chord distance
    for (const ca of A.clusters) {
      for (const cb of B.clusters) {
        const dot = ca.c[0] * cb.c[0] + ca.c[1] * cb.c[1] + ca.c[2] * cb.c[2];
        const lower = Math.acos(Math.min(1, Math.max(-1, dot))) - ca.r - cb.r;
        if (lower > 0) {
          const chord = 2 * Math.sin(lower / 2);
          if (chord * chord >= best) continue; // whole cluster pair cannot improve
        }
        for (let a = ca.from; a < ca.to; a++) {
          const ax = A.v[a * 3], ay = A.v[a * 3 + 1], az = A.v[a * 3 + 2];
          for (let b = cb.from; b < cb.to; b++) {
            const dx = ax - B.v[b * 3], dy = ay - B.v[b * 3 + 1], dz = az - B.v[b * 3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < best) best = d2;
          }
        }
      }
    }
    const chord = Math.sqrt(best);
    const km = 2 * R * Math.asin(Math.min(1, chord / 2));
    dist[at(i, j)] = Math.round(Math.min(65535, km));
  }
}
console.log(`[data] distance matrix: ${n} countries in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ------------------------------------------------------------------- outputs

const keep = new Set(metas.map((m) => m.id));

/**
 * Render geometry is simplified hard. The extruded-polygon globe layer builds one
 * mesh per country, so full 50m detail costs ~35x the frame budget for detail that
 * is invisible at globe zoom. Distances above were computed on the full-resolution
 * geometry, so nothing about gameplay depends on this.
 *
 * Simplification is topology-preserving (shared arcs stay shared), so neighbouring
 * countries do not develop gaps.
 */
const RETAIN = 0.1; // fraction of arc points kept

const rewritten: Topology = {
  type: 'Topology',
  arcs: topo.arcs,
  transform: topo.transform,
  objects: {
    countries: {
      type: 'GeometryCollection',
      geometries: (topo.objects.countries.geometries as any[])
        .map((g) => {
          const src = g.id ? byCcn3.get(g.id) : undefined;
          const id = src ? src.cca3 : (UNMATCHED[g.properties?.name] as Meta | undefined)?.id;
          return id && keep.has(id) ? { ...g, id, properties: {} } : null;
        })
        .filter(Boolean) as any[],
    },
  },
};

// presimplify/simplify mutate arcs in place, so work on a copy.
const pre = presimplify(JSON.parse(JSON.stringify(rewritten)) as any);
const simplified = simplify(pre, quantile(pre, RETAIN)) as unknown as Topology;

/**
 * The globe layer emits a cap, a side wall and a stroke line per polygon *ring*,
 * so the world's 1,600-odd islands cost ~4,800 draw calls a frame regardless of
 * how few vertices they hold. Dropping the ones too small to see brings that
 * down by an order of magnitude. Every country keeps its largest landmass, so
 * island nations stay on the map.
 */
const MIN_PART_KM2 = 700;
const MAX_PARTS = 10;

type Ring = Array<[number, number]>;

/** Signed spherical excess, km^2. Sign tells us nothing here, so take |area|. */
function ringAreaKm2(ring: Ring): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lng1, lat1] = ring[j];
    const [lng2, lat2] = ring[i];
    total += ((lng2 - lng1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

const simplifiedFc = feature(simplified, simplified.objects.countries) as unknown as {
  features: Array<{ id: string; geometry: any }>;
};

let partsBefore = 0;
let partsAfter = 0;
const renderFeatures = simplifiedFc.features.map((f) => {
  const polys: Ring[][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  partsBefore += polys.length;

  const ranked = polys
    .map((rings) => ({ rings, area: ringAreaKm2(rings[0]) }))
    .sort((a, b) => b.area - a.area);
  const kept = ranked
    .filter((p, i) => i === 0 || (p.area >= MIN_PART_KM2 && i < MAX_PARTS))
    // Holes below the same threshold are invisible and cost a ring each.
    .map(({ rings }) => [rings[0], ...rings.slice(1).filter((h) => ringAreaKm2(h) >= MIN_PART_KM2)]);
  partsAfter += kept.length;

  return {
    type: 'Feature' as const,
    id: f.id,
    properties: { id: f.id },
    geometry: {
      type: 'MultiPolygon' as const,
      coordinates: kept.map((rings) =>
        rings.map((r) => r.map(([lng, lat]) => [round(lng), round(lat)]))),
    },
  };
});

const mergedRender = new Map<string, (typeof renderFeatures)[number]>();
for (const f of renderFeatures) {
  const prev = mergedRender.get(f.id);
  if (prev) prev.geometry.coordinates.push(...f.geometry.coordinates);
  else mergedRender.set(f.id, f);
}
const geometryOut = { type: 'FeatureCollection' as const, features: [...mergedRender.values()] };
const ringCount = renderFeatures.reduce(
  (n, f) => n + f.geometry.coordinates.reduce((m, p) => m + p.length, 0), 0);
console.log(`[data] render geometry: ${partsBefore} -> ${partsAfter} parts, ${ringCount} rings`);

let maxDist = 0;
for (const d of dist) maxDist = Math.max(maxDist, d);

writeFileSync(new URL('countries.json', OUT), JSON.stringify({
  version: 1,
  maxDistanceKm: maxDist,
  countries: metas,
}));
writeFileSync(new URL('dist.bin', OUT), Buffer.from(dist.buffer));
writeFileSync(new URL('geometry.json', OUT), JSON.stringify(geometryOut));

console.log(`[data] ${n} countries, ${metas.filter((m) => m.playable).length} playable, max ${maxDist}km`);
console.log(`[data] regions: ${[...new Set(metas.map((m) => m.subregion))].sort().join(', ')}`);
