import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/** One entry of a {@link Menu}. */
export type MenuItem = {
  /** The entry's text. */
  label: string;
  /** Makes it a page link inside the app (a router path such as `/run/<id>`) instead of an action. */
  to?: string;
  /** Called when chosen; the menu closes first. Ignored when `to` is set. */
  onSelect?: () => void;
  /** Makes it an on/off entry that shows a tick when `true`. Leave out for a plain action or link. */
  checked?: boolean;
};

/** Props of {@link Menu}. */
export type MenuProps = {
  /** The ⋯ button's accessible name, e.g. "Step 1 options". */
  label: string;
  /** The entries, in order. An empty list renders nothing. */
  items: MenuItem[];
};

/**
 * A ⋯ button that opens a small list of actions, links and on/off entries. Choosing an entry, Escape, or a
 * click anywhere outside closes it.
 */
export const Menu = ({ label, items }: MenuProps) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!items.length) return null;
  const choose = (item: MenuItem) => {
    setOpen(false);
    item.onSelect?.();
  };
  return (
    <div className="menu" ref={box}>
      <button type="button" className="btn small menu-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={label}>
          {items.map((item, i) =>
            item.to ? (
              <Link key={item.label} role="menuitem" to={item.to} autoFocus={i === 0} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                autoFocus={i === 0}
                onClick={() => choose(item)}
              >
                <span className="tick">{item.checked ? '✓' : ''}</span>
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
};
