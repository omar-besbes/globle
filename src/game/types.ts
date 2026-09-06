export interface Country {
  id: string;
  name: string;
  iso2: string;
  iso3: string;
  region: string;
  subregion: string;
  /** Can be the answer. Territories and disputed areas are guessable but never targets. */
  playable: boolean;
  territory: boolean;
  disputed: boolean;
  lat: number;
  lng: number;
  aliases: string[];
}

export interface Guess {
  /** Exactly what the player typed, before resolution. */
  input: string;
  /** Epoch ms. */
  at: number;
  /** Resolved country id. */
  countryId: string;
  /** Border-to-border km from the target. 0 means correct or adjacent. */
  distanceKm: number;
}

export type Outcome = 'solved' | 'gave_up' | 'abandoned';

export interface GameRecord {
  id: string;
  targetId: string;
  startedAt: number;
  endedAt: number | null;
  outcome: Outcome | null;
  /** Subregions the target was drawn from, for reproducing the context later. */
  scope: string[];
  strategy: Strategy;
  /** Ordered. On a solved game the last entry is the target. */
  guesses: Guess[];
}

export type Strategy = 'adaptive' | 'random';

export interface Settings {
  /** Selected subregion names. Empty means the whole world. */
  scope: string[];
  strategy: Strategy;
  showDistances: boolean;
  spinOnGuess: boolean;
}

export interface SaveFile {
  schemaVersion: number;
  exportedAt: number;
  games: GameRecord[];
  settings: Settings;
}
