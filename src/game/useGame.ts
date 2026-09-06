import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import type { DataPack } from './data';
import { poolFor } from './data';
import { pickTarget } from './selection';
import {
  DEFAULT_SETTINGS, loadGames, loadSettings, saveGames, saveSettings,
} from './storage';
import { HINTS } from './types';
import type { GameRecord, Guess, Settings } from './types';

const CURRENT_KEY = 'globle:current';
const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export type GuessResult =
  | { ok: true; guess: Guess; solved: boolean }
  | { ok: false; reason: 'unknown' | 'duplicate' | 'empty' };

export function useGame(data: DataPack | null) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [current, setCurrent] = useState<GameRecord | null>(null);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(settings);
  const gamesRef = useRef(games);
  const currentRef = useRef(current);
  settingsRef.current = settings;
  gamesRef.current = games;
  currentRef.current = current;

  const pool = useMemo(
    () => (data ? poolFor(data.countries, settings.scope) : []),
    [data, settings.scope]);

  // ---- boot -------------------------------------------------------------
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      const [s, g, c] = await Promise.all([
        loadSettings(), loadGames(), get<GameRecord | null>(CURRENT_KEY),
      ]);
      if (cancelled) return;
      setSettings(s);
      gamesRef.current = g;
      setGames(g);
      // Only resume a game whose target still exists in the current data pack.
      setCurrent(c && data.byId.has(c.targetId) && !c.outcome ? c : null);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [data]);

  const persistCurrent = useCallback((game: GameRecord | null) => {
    currentRef.current = game;
    setCurrent(game);
    void set(CURRENT_KEY, game);
  }, []);

  /**
   * Adds a finished game to history. Skipped entirely when tracking is off -
   * the round still plays out, it just leaves nothing behind.
   */
  const commit = useCallback((game: GameRecord) => {
    if (!settingsRef.current.trackGuesses) return;
    const next = [...gamesRef.current, game];
    gamesRef.current = next;
    setGames(next);
    void saveGames(next);
  }, []);

  // ---- lifecycle --------------------------------------------------------
  const newGame = useCallback((opts?: Partial<Settings>) => {
    if (!data) return;
    const s = { ...settingsRef.current, ...opts };
    const strategy = s.trackGuesses ? 'adaptive' : 'random';
    const nextPool = poolFor(data.countries, s.scope);
    if (nextPool.length === 0) return;

    // An in-progress game with guesses is history too - record it as abandoned.
    const prev = currentRef.current;
    if (prev && !prev.outcome && prev.guesses.length > 0) {
      commit({ ...prev, outcome: 'abandoned', endedAt: Date.now() });
    }

    const history = gamesRef.current;
    const target = pickTarget({
      pool: nextPool,
      games: history,
      strategy,
      recentTargets: history.slice(-12).map((g) => g.targetId),
    });
    if (!target) return;

    persistCurrent({
      id: newId(),
      targetId: target.id,
      startedAt: Date.now(),
      endedAt: null,
      outcome: null,
      scope: s.scope,
      strategy,
      hintsUsed: 0,
      guesses: [],
    });
  }, [data, commit, persistCurrent]);

  // Auto-start once there is data and nothing in progress.
  useEffect(() => {
    if (ready && data && !current && pool.length > 0) newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, current, pool.length]);

  const guess = useCallback((input: string): GuessResult => {
    if (!data || !current || current.outcome) return { ok: false, reason: 'empty' };
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    const country = data.resolve(trimmed);
    if (!country) return { ok: false, reason: 'unknown' };
    if (current.guesses.some((g) => g.countryId === country.id)) {
      return { ok: false, reason: 'duplicate' };
    }

    const entry: Guess = {
      input: trimmed,
      at: Date.now(),
      countryId: country.id,
      distanceKm: data.distanceKm(country.id, current.targetId),
    };
    const solved = country.id === current.targetId;
    const next: GameRecord = {
      ...current,
      guesses: [...current.guesses, entry],
      outcome: solved ? 'solved' : null,
      endedAt: solved ? entry.at : null,
    };
    persistCurrent(next);
    if (solved) commit(next);
    return { ok: true, guess: entry, solved };
  }, [data, current, commit, persistCurrent]);

  /** Takes the next hint in HINTS order. Hints count against you in the stats. */
  const useHint = useCallback(() => {
    const game = currentRef.current;
    if (!game || game.outcome || game.hintsUsed >= HINTS.length) return;
    persistCurrent({ ...game, hintsUsed: game.hintsUsed + 1 });
  }, [persistCurrent]);

  const giveUp = useCallback(() => {
    if (!current || current.outcome) return;
    const next: GameRecord = { ...current, outcome: 'gave_up', endedAt: Date.now() };
    persistCurrent(next);
    commit(next);
  }, [current, commit, persistCurrent]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const replaceHistory = useCallback((next: GameRecord[]) => {
    gamesRef.current = next;
    setGames(next);
    void saveGames(next);
  }, []);

  return {
    ready, settings, games, current, pool,
    newGame, guess, giveUp, useHint, updateSettings, replaceHistory,
  };
}
