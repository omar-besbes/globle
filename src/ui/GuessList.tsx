import type { DataPack } from '../game/data';
import { formatDistance, heatColor } from '../game/color';
import type { Guess, Units } from '../game/types';

interface Props {
  data: DataPack;
  guesses: Guess[];
  units: Units;
  onFocus(id: string): void;
}

export function GuessList({ data, guesses, units, onFocus }: Props) {
  if (guesses.length === 0) {
    return <p className="empty">No guesses yet. Type any country to start narrowing it down.</p>;
  }
  // Closest first: the ranking is the actual feedback signal.
  const ordered = [...guesses].sort((a, b) => a.distanceKm - b.distanceKm);

  return (
    <ol className="guess-list">
      {ordered.map((g) => {
        const c = data.byId.get(g.countryId);
        return (
          <li key={g.countryId} onClick={() => onFocus(g.countryId)} title="Show on globe">
            <span className="swatch" style={{ background: heatColor(g.distanceKm, data.maxDistanceKm) }} />
            <span className="guess-name">{c?.name ?? g.countryId}</span>
            <span className="guess-meta">
              {formatDistance(g.distanceKm, units, data.maxDistanceKm)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
