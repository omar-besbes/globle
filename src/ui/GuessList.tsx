import type { DataPack } from '../game/data';
import { formatDistance, heatColor, proximity } from '../game/color';
import type { Guess } from '../game/types';

interface Props {
  data: DataPack;
  guesses: Guess[];
  showDistances: boolean;
  onFocus(id: string): void;
}

export function GuessList({ data, guesses, showDistances, onFocus }: Props) {
  if (guesses.length === 0) {
    return <p className="empty">No guesses yet. Type a country, or click one on the globe.</p>;
  }
  // Closest first: the ranking is the actual feedback signal.
  const ordered = [...guesses].sort((a, b) => a.distanceKm - b.distanceKm);

  return (
    <ol className="guess-list">
      {ordered.map((g) => {
        const c = data.byId.get(g.countryId);
        const p = proximity(g.distanceKm, data.maxDistanceKm);
        return (
          <li key={g.countryId} onClick={() => onFocus(g.countryId)} title="Show on globe">
            <span className="swatch" style={{ background: heatColor(g.distanceKm, data.maxDistanceKm) }} />
            <span className="guess-name">{c?.name ?? g.countryId}</span>
            <span className="guess-meta">
              {showDistances ? formatDistance(g.distanceKm) : `${Math.round(p * 100)}%`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
