import { useMemo } from 'react';
import { poolFor, scopeTree } from '../game/data';
import type { DataPack } from '../game/data';
import type { Settings } from '../game/types';

interface Props {
  data: DataPack;
  settings: Settings;
  onChange(patch: Partial<Settings>): void;
  onApply(): void;
}

export function ScopePanel({ data, settings, onChange, onApply }: Props) {
  const tree = useMemo(() => scopeTree(data.countries), [data]);
  const selected = new Set(settings.scope);
  const poolSize = poolFor(data.countries, settings.scope).length;

  const toggle = (sub: string) => {
    const next = new Set(selected);
    if (next.has(sub)) next.delete(sub); else next.add(sub);
    onChange({ scope: [...next] });
  };

  const setRegion = (subs: string[], on: boolean) => {
    const next = new Set(selected);
    for (const s of subs) if (on) next.add(s); else next.delete(s);
    onChange({ scope: [...next] });
  };

  return (
    <div className="panel-body">
      <p className="hint">
        Pick the countries you want to be quizzed on. Nothing selected means the whole world.
      </p>

      <div className="scope-actions">
        <button onClick={() => onChange({ scope: [] })}>Whole world</button>
        {tree.map(({ region, subregions }) => (
          <button key={region} onClick={() => onChange({ scope: subregions })}>{region}</button>
        ))}
      </div>

      <div className="scope-grid">
        {tree.map(({ region, subregions }) => {
          const all = subregions.every((s) => selected.has(s));
          return (
            <div key={region} className="scope-group">
              <div className="scope-group-head">
                <strong>{region}</strong>
                <button className="link" onClick={() => setRegion(subregions, !all)}>
                  {all ? 'none' : 'all'}
                </button>
              </div>
              {subregions.map((sub) => (
                <label key={sub}>
                  <input type="checkbox" checked={selected.has(sub)} onChange={() => toggle(sub)} />
                  <span>{sub}</span>
                  <span className="count">
                    {data.countries.filter((c) => c.playable && c.subregion === sub).length}
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </div>

      <div className="panel-footer">
        <span className={poolSize === 0 ? 'warn' : 'hint'}>
          {poolSize === 0 ? 'Select at least one area.' : `${poolSize} countries in play`}
        </span>
        <button className="primary" disabled={poolSize === 0} onClick={onApply}>
          Start a round here
        </button>
      </div>
    </div>
  );
}
