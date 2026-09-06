/**
 * Sanity checks over the generated data pack. Run with `npm run check`.
 * These guard the two things a wrong build would silently break: the distance
 * matrix and click hit-testing.
 */
import { readFileSync } from 'node:fs';
import { buildMatcher, normalize } from '../src/game/data';
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

// --- typed input ----------------------------------------------------------
const { resolve, suggest } = buildMatcher(countries);
const R = (q: string) => resolve(q)?.id ?? null;

// Aliases people actually type.
const aliases: Array<[string, string]> = [
  ['holland', 'NLD'], ['burma', 'MMR'], ['uk', 'GBR'], ['usa', 'USA'],
  ['ivory coast', 'CIV'], ['south korea', 'KOR'], ['drc', 'COD'], ['east timor', 'TLS'],
];
for (const [q, id] of aliases) check(`alias "${q}"`, R(q) === id, `-> ${R(q)}`);

// Typos and misspellings that should still land.
const typos: Array<[string, string]> = [
  ['brasil', 'BRA'], ['phillipines', 'PHL'], ['swizerland', 'CHE'], ['kenia', 'KEN'],
  ['untied states', 'USA'], ['germny', 'DEU'], ['argentna', 'ARG'], ['netherlads', 'NLD'],
  ['madagascer', 'MDG'], ['kazakstan', 'KAZ'],
];
for (const [q, id] of typos) check(`typo "${q}"`, R(q) === id, `-> ${R(q)}`);

// Near-miss pairs must never silently resolve to their neighbour.
const exactPairs = ['Iran', 'Iraq', 'Niger', 'Nigeria', 'Austria', 'Australia', 'Chad', 'Chile',
  'China', 'Mali', 'Malta', 'Zambia', 'Gambia', 'Guinea', 'Guyana', 'Oman', 'Romania',
  'India', 'Indonesia', 'Slovakia', 'Slovenia', 'Norway', 'Nauru'];
for (const name of exactPairs) {
  const c = countries.find((x) => x.name === name);
  check(`exact "${name}"`, c !== undefined && R(name) === c.id, `-> ${R(name)}`);
}

// Ambiguity and nonsense are rejected rather than guessed at.
for (const q of ['ambia', 'united', 'qqqqqq', 'zzzz', 'the country that is not', 'mata']) {
  check(`rejects "${q}"`, R(q) === null, `-> ${R(q)}`);
}
check('rejects empty', R('   ') === null);

/**
 * The property that matters: mangling a country's name by one character must
 * never quietly score a guess against a DIFFERENT country. Resolving to the
 * intended country or to nothing are both fine, and so is completing a prefix -
 * "austra" is a reasonable start on Australia even though it is also Austria
 * with a letter dropped. Anything else is the matcher being too eager.
 */
function mutationsOf(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < name.length; i++) out.push(name.slice(0, i) + name.slice(i + 1));
  for (let i = 0; i + 1 < name.length; i++) {
    out.push(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2));
  }
  return out;
}

const overeager: string[] = [];
for (const c of countries) {
  for (const q of mutationsOf(normalize(c.name))) {
    const got = resolve(q);
    if (!got || got.id === c.id) continue;
    if (normalize(got.name).startsWith(q)) continue; // completing a real name
    overeager.push(`"${q}" (${c.name}) -> ${got.name}`);
  }
}
check('one-character slips never pick another country', overeager.length === 0,
  overeager.length ? `${overeager.length} cases, e.g. ${overeager.slice(0, 4).join('; ')}` : '');

check('suggestions rank the typo target first', suggest('brasil')[0]?.id === 'BRA',
  `-> ${suggest('brasil')[0]?.name}`);
check('suggestions cover prefixes', suggest('unit').some((c) => c.id === 'GBR'));

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
