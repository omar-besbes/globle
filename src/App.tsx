import { useEffect, useMemo, useState } from 'react';
import { loadData, type DataPack } from './game/data';
import { useGame } from './game/useGame';
import { formatDistance, heatColor } from './game/color';
import { GlobeView } from './ui/GlobeView';
import { GuessInput } from './ui/GuessInput';
import { GuessList } from './ui/GuessList';
import { ScopePanel } from './ui/ScopePanel';
import { StatsPanel } from './ui/StatsPanel';

type Panel = 'scope' | 'stats' | null;

export default function App() {
  const [data, setData] = useState<DataPack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    loadData().then(setData).catch((e) => setLoadError(String(e)));
  }, []);

  const game = useGame(data);
  const { current, settings } = game;

  const guessed = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of current?.guesses ?? []) m.set(g.countryId, g.distanceKm);
    return m;
  }, [current]);

  const over = Boolean(current?.outcome);
  const target = current && data ? data.byId.get(current.targetId) : null;
  const closest = useMemo(() => {
    const list = current?.guesses ?? [];
    return list.length ? list.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a)) : null;
  }, [current]);

  const submit = (raw: string) => {
    if (!data) return;
    const res = game.guess(raw);
    if (res.ok) {
      setError(null);
      setFocusId(settings.spinOnGuess ? res.guess.countryId : null);
      return;
    }
    setError(res.reason === 'unknown'
      ? `“${raw.trim()}” is not a country I know.`
      : res.reason === 'duplicate' ? 'You already guessed that one.' : null);
  };

  if (loadError) return <div className="boot error">Could not load map data: {loadError}</div>;
  if (!data || !game.ready) return <div className="boot">Loading the world…</div>;

  return (
    <div className="app">
      <header>
        <h1>Globle<span className="dot">·</span><em>custom</em></h1>
        <nav>
          <button className={panel === 'scope' ? 'on' : ''} onClick={() => setPanel(panel === 'scope' ? null : 'scope')}>
            Countries
          </button>
          <button className={panel === 'stats' ? 'on' : ''} onClick={() => setPanel(panel === 'stats' ? null : 'stats')}>
            Stats
          </button>
        </nav>
      </header>

      <main>
        <GlobeView
          data={data}
          guessed={guessed}
          revealedId={current?.outcome === 'gave_up' ? current.targetId : null}
          focusId={focusId}
          onPick={(id) => submit(data.byId.get(id)?.name ?? id)}
        />

        <aside>
          <div className="scope-line">
            <span>{settings.scope.length === 0 ? 'Whole world' : settings.scope.join(', ')}</span>
            <span className="pool">{game.pool.length} countries</span>
          </div>

          <div className="mode-line">
            {(['adaptive', 'random'] as const).map((s) => (
              <button
                key={s}
                className={settings.strategy === s ? 'on' : ''}
                onClick={() => game.updateSettings({ strategy: s })}
                title={s === 'adaptive'
                  ? 'Targets the countries you struggle with most'
                  : 'Uniformly random from the selected countries'}
              >{s}</button>
            ))}
            <button
              className={settings.showDistances ? 'on' : ''}
              onClick={() => game.updateSettings({ showDistances: !settings.showDistances })}
              title="Show kilometres instead of a closeness percentage"
            >km</button>
          </div>

          {!over && (
            <GuessInput data={data} disabled={over} error={error} onSubmit={submit} />
          )}

          {over && target && (
            <div className={`result ${current!.outcome}`}>
              <p className="result-head">
                {current!.outcome === 'solved'
                  ? `Got it in ${current!.guesses.length} ${current!.guesses.length === 1 ? 'guess' : 'guesses'}`
                  : 'The answer was'}
              </p>
              <p className="result-name">{target.name}</p>
              <p className="result-meta">{target.subregion}</p>
              <button className="primary" onClick={() => { setFocusId(null); game.newGame(); }}>
                Next country
              </button>
            </div>
          )}

          {!over && closest && (
            <div className="closest" style={{ borderColor: heatColor(closest.distanceKm, data.maxDistanceKm) }}>
              closest so far · {data.byId.get(closest.countryId)?.name} ·{' '}
              {formatDistance(closest.distanceKm)}
            </div>
          )}

          <GuessList
            data={data}
            guesses={current?.guesses ?? []}
            showDistances={settings.showDistances}
            onFocus={setFocusId}
          />

          {!over && (
            <div className="aside-footer">
              <button onClick={() => { setFocusId(null); game.newGame(); }}>Skip</button>
              <button className="danger" onClick={game.giveUp} disabled={!current}>Give up</button>
            </div>
          )}
        </aside>
      </main>

      {panel && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setPanel(null); }}>
          <section className="panel">
            <div className="panel-head">
              <h2>{panel === 'scope' ? 'Which countries?' : 'Your progress'}</h2>
              <button className="close" onClick={() => setPanel(null)} aria-label="Close">×</button>
            </div>
            {panel === 'scope'
              ? <ScopePanel
                  data={data}
                  settings={settings}
                  onChange={game.updateSettings}
                  onApply={() => { setPanel(null); setFocusId(null); game.newGame(); }}
                />
              : <StatsPanel
                  data={data}
                  games={game.games}
                  settings={settings}
                  onReplaceHistory={game.replaceHistory}
                />}
          </section>
        </div>
      )}
    </div>
  );
}
