import { useEffect, useRef, useState } from 'react';
import type { Country } from '../game/types';

/** What the last submission produced, shown under the field. */
export type Feedback =
  | { kind: 'none' }
  | { kind: 'unknown' }
  | { kind: 'duplicate'; country: Country }
  | { kind: 'suggest'; candidates: Country[] };

interface Props {
  disabled: boolean;
  feedback: Feedback;
  /** Bumped when a guess is recorded; that is the only time the field clears. */
  clearSignal: number;
  onSubmit(value: string): void;
  onAccept(country: Country): void;
  onEdit(): void;
}

export function GuessInput({ disabled, feedback, clearSignal, onSubmit, onAccept, onEdit }: Props) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!disabled) input.current?.focus(); }, [disabled]);

  // Only a recorded guess clears the field. A question about what was meant
  // leaves the text in place so it can be corrected or confirmed.
  useEffect(() => { setValue(''); }, [clearSignal]);

  return (
    <div className="guess-input">
      <input
        ref={input}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={disabled ? 'Round over' : 'Type a country…'}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Type a country"
        onChange={(e) => { setValue(e.target.value); onEdit(); }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onSubmit(value);
        }}
      />

      {feedback.kind === 'unknown' && (
        <p className="input-note error">No such country exists.</p>
      )}

      {feedback.kind === 'duplicate' && (
        <p className="input-note">
          You already guessed <strong>{feedback.country.name}</strong>.
        </p>
      )}

      {feedback.kind === 'suggest' && (
        <p className="input-note">
          Maybe you meant{' '}
          {feedback.candidates.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ' or '}
              <button className="did-you-mean" onClick={() => onAccept(c)}>{c.name}</button>
            </span>
          ))}{'?'}
          {feedback.candidates.length === 1 && (
            <span className="input-hint"> Press Enter again to accept.</span>
          )}
        </p>
      )}
    </div>
  );
}
