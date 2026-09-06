/**
 * Sanity checks over the generated data pack. Run with `npm run check`.
 * These guard the two things a wrong build would silently break: the distance
 * matrix and click hit-testing.
 */
import { readFileSync } from 'node:fs';
import { buildLocator } from '../src/game/data';
import type { Country } from '../src/game/types';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const meta = read('countries.json');
const geo = read('geometry.json');
const countries: Country[] = meta.countries;
const byId = new Map(countries.map((c) => [c.id, c]));
const index = new Map(countries.map((c, i) => [c.id, i]));
const n = countries.length;

const buf = readFileSync(new URL('../public/data/dist.bin', import.meta.url));
const dist = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
const at = (i: number, j: number) => (i * (2 * n - i - 1)) / 2 + (j - i - 1);
const D = (a: string, b: string) => {
  let i = index.get(a)!, j = index.get(b)!;
  if (i > j) [i, j] = [j, i];
  return dist[at(i, j)];
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.log(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name} ${detail}`);
};

// --- distances ------------------------------------------------------------
const bordering: Array<[string, string]> = [
  ['FRA', 'DEU'], ['USA', 'CAN'], ['ESP', 'PRT'], ['IND', 'PAK'], ['KEN', 'TZA'],
];
for (const [a, b] of bordering) check(`${a}-${b} border`, D(a, b) === 0, `${D(a, b)}km`);

const ordered: Array<[string, string, string]> = [
  ['FRA', 'ITA', 'JPN'], ['KEN', 'ETH', 'ISL'], ['CHL', 'ARG', 'MNG'], ['JPN', 'KOR', 'BRA'],
];
for (const [x, near, far] of ordered) {
  check(`${x}: ${near} closer than ${far}`, D(x, near) < D(x, far), `${D(x, near)} < ${D(x, far)}`);
}
check('symmetric', D('BRA', 'AUS') === D('AUS', 'BRA'));
check('max distance sane', meta.maxDistanceKm > 15000 && meta.maxDistanceKm < 20100, `${meta.maxDistanceKm}km`);

let missing = 0;
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (dist[at(i, j)] === 0) missing++;
check('few zero pairs', missing < 400, `${missing} zero-distance pairs`);

// --- hit testing ----------------------------------------------------------
const locate = buildLocator(geo.features, byId);
const points: Array<[number, number, string | null]> = [
  [48.85, 2.35, 'FRA'],    // Paris
  [-15.79, -47.88, 'BRA'], // Brasilia
  [35.68, 139.69, 'JPN'],  // Tokyo
  [-33.87, 151.21, 'AUS'], // Sydney
  [55.75, 37.62, 'RUS'],   // Moscow
  [1.29, 32.29, 'UGA'],    // central Uganda
  [40.71, -74.0, 'USA'],   // New York
  [0, -30, null],          // mid-Atlantic
  [-40, -140, null],       // south Pacific
];
for (const [lat, lng, expected] of points) {
  const got = locate(lat, lng);
  check(`locate ${lat},${lng}`, (got?.id ?? null) === expected, `-> ${got?.name ?? 'water'}`);
}

// --- metadata -------------------------------------------------------------
check('no duplicate ids', new Set(countries.map((c) => c.id)).size === countries.length);
check('one geometry per country',
  new Set(geo.features.map((f: any) => f.properties.id)).size === geo.features.length);
check('playable pool', countries.filter((c) => c.playable).length > 180);
check('every country has aliases', countries.every((c) => c.aliases.length > 0));
const dupes = new Map<string, number>();
for (const c of countries) for (const a of c.aliases) dupes.set(a, (dupes.get(a) ?? 0) + 1);
check('no ambiguous aliases', [...dupes.values()].every((v) => v === 1),
  `${[...dupes].filter(([, v]) => v > 1).map(([a]) => a).slice(0, 5).join(', ')}`);
check('geometry covers metadata', countries.every((c) => geo.features.some((f: any) => f.properties.id === c.id)));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
