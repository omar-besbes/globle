import { UNIT_LABELS } from '../game/color';
import type { Settings, Units } from '../game/types';

interface Props {
  settings: Settings;
  /** Rounds already recorded, so the tracking toggle can say what is at stake. */
  recordedGames: number;
  onChange(patch: Partial<Settings>): void;
}

const UNIT_ORDER: Units[] = ['km', 'mi', 'percent'];

export function SettingsPanel({ settings, recordedGames, onChange }: Props) {
  return (
    <div className="panel-body settings">
      <section className="setting">
        <div className="setting-head">
          <div>
            <h3>Track my guesses</h3>
            <p className="hint">
              Records every finished round in this browser and uses it to pick countries
              you struggle with. Turn it off and rounds leave no trace, with targets
              drawn uniformly at random instead.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.trackGuesses}
            className={`toggle ${settings.trackGuesses ? 'on' : ''}`}
            onClick={() => onChange({ trackGuesses: !settings.trackGuesses })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="hint quiet">
          {settings.trackGuesses
            ? `Targeting adapts to ${recordedGames} recorded ${recordedGames === 1 ? 'round' : 'rounds'}.`
            : recordedGames > 0
              ? `${recordedGames} recorded ${recordedGames === 1 ? 'round' : 'rounds'} kept but not added to. Clear them under Stats.`
              : 'Nothing is being recorded.'}
        </p>
      </section>

      <section className="setting">
        <h3>Distance units</h3>
        <p className="hint">How each guess reports its distance from the answer.</p>
        <div className="segmented">
          {UNIT_ORDER.map((u) => (
            <button
              key={u}
              className={settings.units === u ? 'on' : ''}
              aria-pressed={settings.units === u}
              onClick={() => onChange({ units: u })}
            >{UNIT_LABELS[u]}</button>
          ))}
        </div>
      </section>

      <section className="setting">
        <div className="setting-head">
          <div>
            <h3>Fly to each guess</h3>
            <p className="hint">Rotates the globe to a country when you guess it.</p>
          </div>
          <button
            role="switch"
            aria-checked={settings.spinOnGuess}
            className={`toggle ${settings.spinOnGuess ? 'on' : ''}`}
            onClick={() => onChange({ spinOnGuess: !settings.spinOnGuess })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </section>
    </div>
  );
}
