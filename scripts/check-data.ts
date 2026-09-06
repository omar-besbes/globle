/**
 * Sanity checks over the generated data pack. Run with `npm run check`.
 * These guard the two things a wrong build would silently break: the distance
 * matrix and click hit-testing.
 */
import { readFileSync } from 'node:fs';
import { buildMatcher, normalize } from '../src/game/data';
import { SCHEMA_VERSION, parseSaveFile } from '../src/game/storage';
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
const { match } = buildMatcher(countries);
/** The country a submission would guess outright, or null if it would not. */
const taken = (q: string) => { const m = match(q); return m.kind === 'exact' ? m.country.id : null; };
const proposed = (q: string) => {
  const m = match(q);
  return m.kind === 'suggest' ? m.candidates.map((c) => c.id) : null;
};

// Aliases and prefixes people type on purpose are taken as the guess.
const accepted: Array<[string, string]> = [
  ['France', 'FRA'], ['holland', 'NLD'], ['burma', 'MMR'], ['uk', 'GBR'], ['usa', 'USA'],
  ['ivory coast', 'CIV'], ['south korea', 'KOR'], ['drc', 'COD'], ['east timor', 'TLS'],
  ['switz', 'CHE'], ['bosnia', 'BIH'], ['united arab', 'ARE'], ['brasil', 'BRA'],
];
for (const [q, id] of accepted) check(`accepts "${q}"`, taken(q) === id, `-> ${taken(q)}`);

// Misspellings are offered, never taken - the player confirms the correction.
const suggested: Array<[string, string]> = [
  ['cjina', 'CHN'], ['phillipines', 'PHL'], ['swizerland', 'CHE'], ['kenia', 'KEN'],
  ['untied states', 'USA'], ['germny', 'DEU'], ['argentna', 'ARG'], ['netherlads', 'NLD'],
  ['madagascer', 'MDG'], ['kazakstan', 'KAZ'],
];
for (const [q, id] of suggested) {
  check(`suggests "${q}"`, proposed(q)?.[0] === id, `-> ${proposed(q)?.join('/') ?? match(q).kind}`);
  check(`does not take "${q}"`, taken(q) === null);
}

// Genuine ties list the rivals instead of picking one.
check('"ambia" offers both', proposed('ambia')?.join() === 'GMB,ZMB', `-> ${proposed('ambia')}`);
check('"united" offers rivals', (proposed('united')?.length ?? 0) > 1, `-> ${proposed('united')}`);

// Near-miss pairs still resolve to themselves when typed correctly.
const exactPairs = ['Iran', 'Iraq', 'Niger', 'Nigeria', 'Austria', 'Australia', 'Chad', 'Chile',
  'China', 'Mali', 'Malta', 'Zambia', 'Gambia', 'Guinea', 'Guyana', 'Oman', 'Romania',
  'India', 'Indonesia', 'Slovakia', 'Slovenia', 'Norway', 'Nauru'];
for (const name of exactPairs) {
  const c = countries.find((x) => x.name === name);
  check(`exact "${name}"`, c !== undefined && taken(name) === c.id, `-> ${taken(name)}`);
}

// Text resembling nothing says so rather than proposing something.
for (const q of ['zzzz', 'qqqqqq', 'the country that is not', '   ']) {
  check(`no match for "${q.trim() || 'blank'}"`, match(q).kind === 'none', `-> ${match(q).kind}`);
}

/**
 * The property that matters now that near misses are only ever proposed: a
 * one-character slip must never be TAKEN as a different country. Being offered
 * one is fine - that is a question, not a guess - and so is completing a name.
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
    const got = taken(q);
    if (!got || got === c.id) continue;
    if (normalize(byId.get(got)!.name).startsWith(q)) continue; // completing a real name
    overeager.push(`"${q}" (${c.name}) -> ${byId.get(got)!.name}`);
  }
}
check('one-character slips are never taken as another country', overeager.length === 0,
  overeager.length ? `${overeager.length} cases, e.g. ${overeager.slice(0, 4).join('; ')}` : '');

// --- save migration ------------------------------------------------------
// A v1 export must survive the upgrade: hints did not exist, and the two
// settings that became "track guesses" and "units" were stored differently.
const v1Save = JSON.stringify({
  schemaVersion: 1,
  exportedAt: 1,
  games: [{
    id: 'g1', targetId: 'FRA', startedAt: 1, endedAt: 2, outcome: 'solved',
    scope: [], strategy: 'adaptive', guesses: [{ input: 'france', at: 2, countryId: 'FRA', distanceKm: 0 }],
  }],
  settings: { scope: ['Western Europe'], strategy: 'random', showDistances: false, spinOnGuess: true },
});
const migrated = parseSaveFile(v1Save);
check('v1 save upgrades', migrated.schemaVersion === SCHEMA_VERSION, `-> v${migrated.schemaVersion}`);
check('v1 games gain hintsUsed', migrated.games[0].hintsUsed === 0);
check('v1 guesses survive', migrated.games[0].guesses.length === 1);
check('v1 strategy becomes tracking', migrated.settings.trackGuesses === false);
check('v1 showDistances becomes units', migrated.settings.units === 'percent',
  `-> ${migrated.settings.units}`);
check('v1 scope survives', migrated.settings.scope.join() === 'Western Europe');
check('rejects a newer save',
  (() => { try { parseSaveFile('{"schemaVersion":99,"games":[]}'); return false; } catch { return true; } })());

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
