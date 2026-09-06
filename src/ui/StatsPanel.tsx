import { useMemo, useRef } from 'react';
import type { DataPack } from '../game/data';
import { UNSEEN_PRIOR, weaknessByCountry, weaknessFor } from '../game/selection';
import { mergeGames, parseSaveFile, toSaveFile } from '../game/storage';
import type { GameRecord, Settings } from '../game/types';

interface Props {
  data: DataPack;
  games: GameRecord[];
  settings: Settings;
  onReplaceHistory(games: GameRecord[]): void;
}

export function StatsPanel({ data, games, settings, onReplaceHistory }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const weakness = useMemo(() => weaknessByCountry(games), [games]);

  const played = games.filter((g) => g.outcome === 'solved' || g.outcome === 'gave_up');
  const solved = played.filter((g) => g.outcome === 'solved');
  const avgGuesses = solved.length
    ? solved.reduce((s, g) => s + g.guesses.length, 0) / solved.length
    : 0;

  const hardest = useMemo(() => [...weakness.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 12), [weakness]);

  const download = () => {
    const blob = new Blob([JSON.stringify(toSaveFile(games, settings), null, 2)],
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `globle-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (f: File) => {
    try {
      const save = parseSaveFile(await f.text());
      onReplaceHistory(mergeGames(games, save.games));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  return (
    <div className="panel-body">
      <div className="stat-row">
        <div><span className="stat-num">{played.length}</span><span>{played.length === 1 ? 'round' : 'rounds'}</span></div>
        <div><span className="stat-num">{solved.length}</span><span>solved</span></div>
        <div><span className="stat-num">{avgGuesses ? avgGuesses.toFixed(1) : '—'}</span><span>avg guesses</span></div>
        <div><span className="stat-num">{weakness.size}</span><span>seen</span></div>
      </div>

      <h3>Your weakest countries</h3>
      <p className="hint">
        Scored from guesses taken, how far off your opening guesses were, time, hints, and
        give-ups. While tracking is on, rounds sample from the top of this list.
      </p>
      {hardest.length === 0
        ? <p className="empty">Play a few rounds and this fills in.</p>
        : (
          <ul className="weak-list">
            {hardest.map(([id, w]) => (
              <li key={id}>
                <span className="weak-name">{data.byId.get(id)?.name ?? id}</span>
                <span className="weak-bar"><i style={{ width: `${Math.round(w.score * 100)}%` }} /></span>
                <span className="weak-meta">
                  {w.plays}× · {w.meanGuesses?.toFixed(1)} avg
                  {w.hints ? ` · ${w.hints} hint${w.hints === 1 ? '' : 's'}` : ''}
                  {w.gaveUp ? ` · ${w.gaveUp} gave up` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

      <h3>Unseen so far</h3>
      <p className="hint">
        {data.countries.filter((c) => c.playable && weaknessFor(c.id, weakness).plays === 0).length} playable
        countries you have not been given yet (they start at a {Math.round(UNSEEN_PRIOR * 100)}% difficulty prior).
      </p>

      <h3>Your data</h3>
      <p className="hint">Everything lives in this browser. No account, no server.</p>
      <div className="panel-footer">
        <button onClick={download} disabled={games.length === 0}>Export JSON</button>
        <button onClick={() => file.current?.click()}>Import JSON</button>
        <button
          className="danger"
          onClick={() => { if (confirm('Delete all local history? This cannot be undone.')) onReplaceHistory([]); }}
        >Clear history</button>
        <input
          ref={file} type="file" accept="application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}
