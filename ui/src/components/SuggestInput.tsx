import { useRef, useState } from 'react';

/** Props for {@link SuggestInput}. */
export type SuggestInputProps = {
  /** Element id of the text box; label it with `<label htmlFor={id}>`. Option ids are derived from it. */
  id: string;
  /** Current text. Need not be one of the suggestions. */
  value: string;
  /** Choices to offer, in display order. Repeats show once. Empty gives a plain text box with no list. */
  suggestions: readonly string[];
  /** Shown while the box is empty. */
  placeholder?: string;
  /** `password` masks the text. Default `text`. */
  type?: 'text' | 'password';
  /** Gets the new text on every keystroke and on every pick; `''` when cleared. */
  onChange: (value: string) => void;
};

/**
 * Text box with a suggestion list that always offers every choice when opened by click, ▾ or an arrow key,
 * even when the box already holds a value.
 *
 * Use it instead of `<datalist>`, which only lists choices containing the current text, so a filled box
 * offered one choice. Typing narrows the list to choices containing the typed text, ignoring case;
 * free text that matches nothing is kept as the value.
 */
export const SuggestInput = ({ id, value, suggestions, placeholder, type = 'text', onChange }: SuggestInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(-1);

  if (!suggestions.length)
    return <input id={id} type={type} autoComplete="off" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;

  const choices = [...new Set(suggestions)];
  const query = filtering ? value.trim().toLowerCase() : '';
  const visible = query ? choices.filter((c) => c.toLowerCase().includes(query)) : choices;
  const expanded = open && visible.length > 0;
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-opt-${index}`;

  const close = () => {
    setOpen(false);
    setFiltering(false);
    setActive(-1);
  };
  const openAll = (highlight: number) => {
    setOpen(true);
    setFiltering(false);
    setActive(highlight);
  };
  const pick = (choice: string) => {
    onChange(choice);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const current = choices.indexOf(value);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (expanded) setActive(Math.min(active + 1, visible.length - 1));
      else openAll(Math.max(current, 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (expanded) setActive(Math.max(active - 1, 0));
      else openAll(current >= 0 ? current : choices.length - 1);
    } else if (e.key === 'Enter' && expanded && active >= 0) {
      e.preventDefault();
      pick(visible[active]);
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="suggest">
      <input
        ref={inputRef}
        id={id}
        type={type}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onClick={() => !open && openAll(-1)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setFiltering(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      <button
        type="button"
        className="suggest-toggle"
        tabIndex={-1}
        aria-label="Show all suggestions"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (expanded) close();
          else openAll(-1);
          inputRef.current?.focus();
        }}
      >
        ▾
      </button>
      {expanded && (
        <ul id={listId} role="listbox" className="suggest-list">
          {visible.map((choice, index) => (
            <li
              key={choice}
              id={optionId(index)}
              role="option"
              aria-selected={choice === value}
              className={index === active ? 'active' : undefined}
              ref={index === active ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(choice)}
            >
              {choice}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
