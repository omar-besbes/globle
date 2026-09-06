import { useEffect, useMemo, useRef, useState } from 'react';
import type { DataPack } from '../game/data';
import type { Country } from '../game/types';

interface Props {
  data: DataPack;
  disabled: boolean;
  error: string | null;
  onSubmit(value: string): void;
}

export function GuessInput({ data, disabled, error, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const suggestions = useMemo<Country[]>(
    () => (open && value.trim() ? data.suggest(value, 6) : []),
    [data, value, open]);

  useEffect(() => setActive(0), [value]);
  useEffect(() => { if (!disabled) input.current?.focus(); }, [disabled]);

  const submit = (raw: string) => {
    if (!raw.trim()) return;
    onSubmit(raw);
    setValue('');
    setOpen(false);
  };

  return (
    <div className="guess-input">
      <input
        ref={input}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={disabled ? 'Round over' : 'Guess a country…'}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Guess a country"
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, suggestions.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'Enter') {
            e.preventDefault();
            submit(suggestions[active]?.name ?? value);
          }
        }}
      />
      {suggestions.length > 0 && (
        <ul className="suggestions" role="listbox">
          {suggestions.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => { e.preventDefault(); submit(c.name); }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{c.name}</span>
              <span className="suggestion-meta">{c.subregion}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="input-error">{error}</p>}
    </div>
  );
}
