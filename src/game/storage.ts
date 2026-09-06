import { get, set } from 'idb-keyval';
import type { GameRecord, SaveFile, Settings } from './types';

export const SCHEMA_VERSION = 1;

const GAMES_KEY = 'globle:games';
const SETTINGS_KEY = 'globle:settings';
const VERSION_KEY = 'globle:schemaVersion';

export const DEFAULT_SETTINGS: Settings = {
  scope: [],
  strategy: 'adaptive',
  showDistances: true,
  spinOnGuess: true,
};

/**
 * Migrations run oldest-first. Each takes the whole payload and returns the
 * next version's shape, so a v1 save can always be read by a later build.
 */
const MIGRATIONS: Array<(s: SaveFile) => SaveFile> = [];

function migrate(save: SaveFile): SaveFile {
  let out = save;
  for (let v = out.schemaVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v - 1];
    if (!step) break;
    out = step(out);
    out.schemaVersion = v + 1;
  }
  return out;
}

export async function loadGames(): Promise<GameRecord[]> {
  const version = (await get<number>(VERSION_KEY)) ?? SCHEMA_VERSION;
  const games = (await get<GameRecord[]>(GAMES_KEY)) ?? [];
  if (version === SCHEMA_VERSION) return games;
  const settings = (await get<Settings>(SETTINGS_KEY)) ?? DEFAULT_SETTINGS;
  const migrated = migrate({ schemaVersion: version, exportedAt: Date.now(), games, settings });
  await saveGames(migrated.games);
  return migrated.games;
}

export async function saveGames(games: GameRecord[]): Promise<void> {
  await set(GAMES_KEY, games);
  await set(VERSION_KEY, SCHEMA_VERSION);
}

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await get<Settings>(SETTINGS_KEY)) ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await set(SETTINGS_KEY, settings);
}

export function toSaveFile(games: GameRecord[], settings: Settings): SaveFile {
  return { schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), games, settings };
}

export function parseSaveFile(text: string): SaveFile {
  const raw = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.games)) {
    throw new Error('Not a Globle save file.');
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Save file is from a newer version (v${raw.schemaVersion}).`);
  }
  const save = migrate({
    schemaVersion: raw.schemaVersion ?? 1,
    exportedAt: raw.exportedAt ?? Date.now(),
    games: raw.games,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  });
  return save;
}

/** Union by game id, so importing a file from another device is additive. */
export function mergeGames(existing: GameRecord[], incoming: GameRecord[]): GameRecord[] {
  const byId = new Map(existing.map((g) => [g.id, g]));
  for (const g of incoming) if (!byId.has(g.id)) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}
