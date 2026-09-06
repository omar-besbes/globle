import { useEffect, useMemo, useState } from 'react';
import { loadData, type DataPack } from './game/data';
import { useGame } from './game/useGame';
import { formatDistance, heatColor } from './game/color';
import { GlobeView } from './ui/GlobeView';
import { GuessInput } from './ui/GuessInput';
import { GuessList } from './ui/GuessList';
import { ScopePanel } from './ui/ScopePanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { StatsPanel } from './ui/StatsPanel';
import { HINTS } from './game/types';

type Panel = 'scope' | 'stats' | 'settings' | null;

const PANEL_TITLES: Record<Exclude<Panel, null>, string> = {
  scope: 'Which countries?',
  stats: 'Your progress',
  settings: 'Settings',
};

/** What the next press of Help me will give away. */
const HINT_LABELS = [
  'Outline every country',
  'Reveal the first letter',
];

export default function App() {
  const [data, setData] = useState<DataPack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const hintsUsed = current?.hintsUsed ?? 0;
  const closest = useMemo(() => {
    const list = current?.guesses ?? [];
    return list.length ? list.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a)) : null;
  }, [current]);

  const openPanel = (p: Panel) => {
    setPanel(p);
    setMenuOpen(false);
  };

  const submit = (raw: string) => {
    if (!data) return;
    const res = game.guess(raw);
    if (res.ok) {
      setError(null);
      setFocusId(settings.spinOnGuess ? res.guess.countryId : null);
      return;
    }
    setError(res.reason === 'unknown'
      ? `No country matches “${raw.trim()}”.`
      : res.reason === 'duplicate' ? 'You already guessed that one.' : null);
  };

  if (loadError) return <div className="boot error">Could not load map data: {loadError}</div>;
  if (!data || !game.ready) return <div className="boot">Loading the world…</div>;

  return (
    <div className="app">
      <header>
        <h1>Globle<span className="dot">·</span><em>custom</em></h1>
        <nav>
          <button
            className="menu-toggle"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className={`nav-items ${menuOpen ? 'open' : ''}`}>
            {(['scope', 'stats', 'settings'] as const).map((p) => (
              <button
                key={p}
                className={panel === p ? 'on' : ''}
                onClick={() => openPanel(panel === p ? null : p)}
              >
                {p === 'scope' ? 'Countries' : p === 'stats' ? 'Stats' : 'Settings'}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main>
        <GlobeView
          data={data}
          guessed={guessed}
          revealedId={current?.outcome === 'gave_up' ? current.targetId : null}
          focusId={focusId}
          showAllBorders={hintsUsed >= 1 || over}
        />

        <aside>
          <div className="scope-line">
            <span>{settings.scope.length === 0 ? 'Whole world' : settings.scope.join(', ')}</span>
            <span className="pool">{game.pool.length} countries</span>
          </div>

          {!over && (
            <GuessInput data={data} disabled={over} error={error} onSubmit={submit} />
          )}

          {!over && hintsUsed >= 2 && target && (
            <p className="hint-reveal">
              The answer starts with <strong>{target.name[0].toUpperCase()}</strong>
            </p>
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
              {formatDistance(closest.distanceKm, settings.units, data.maxDistanceKm)}
            </div>
          )}

          <GuessList
            data={data}
            guesses={current?.guesses ?? []}
            units={settings.units}
            onFocus={setFocusId}
          />

          {!over && (
            <div className="aside-footer">
              <button
                className="help"
                disabled={hintsUsed >= HINTS.length}
                title={hintsUsed < HINTS.length ? HINT_LABELS[hintsUsed] : undefined}
                onClick={game.useHint}
              >
                {hintsUsed >= HINTS.length ? 'No hints left' : 'Help me'}
                {hintsUsed < HINTS.length && (
                  <span className="help-next">{HINT_LABELS[hintsUsed]}</span>
                )}
              </button>
              <div className="aside-footer-row">
                <button onClick={() => { setFocusId(null); game.newGame(); }}>Skip</button>
                <button className="danger" onClick={game.giveUp}>Give up</button>
              </div>
            </div>
          )}
        </aside>
      </main>

      {panel && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setPanel(null); }}>
          <section className="panel">
            <div className="panel-head">
              <h2>{PANEL_TITLES[panel]}</h2>
              <button className="close" onClick={() => setPanel(null)} aria-label="Close">×</button>
            </div>
            {panel === 'scope' && (
              <ScopePanel
                data={data}
                settings={settings}
                onChange={game.updateSettings}
                onApply={() => { setPanel(null); setFocusId(null); game.newGame(); }}
              />
            )}
            {panel === 'stats' && (
              <StatsPanel
                data={data}
                games={game.games}
                settings={settings}
                onReplaceHistory={game.replaceHistory}
              />
            )}
            {panel === 'settings' && (
              <SettingsPanel
                settings={settings}
                recordedGames={game.games.length}
                onChange={game.updateSettings}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
