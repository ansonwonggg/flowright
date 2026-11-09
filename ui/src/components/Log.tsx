import { useLayoutEffect, useRef } from 'react';

/** Props of {@link Log}. */
export type LogProps = {
  /** The run's output lines, oldest first; new lines may be appended while it runs. */
  lines: string[];
  /** Opens the log and keeps it there; a finished log starts folded. */
  live: boolean;
  /** The fold's heading and accessible name. Defaults to "Log". */
  label?: string;
};

/**
 * A run's log in a foldable box that follows the newest line while the reader is at the bottom; scrolling
 * up stops the following until they scroll back down.
 */
export const Log = ({ lines, live, label = 'Log' }: LogProps) => {
  const pre = useRef<HTMLPreElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    // No cleanup: this only moves the log's scroll position to the newest line.
    const el = pre.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <section className="log" aria-label={label}>
      <details open={live || undefined}>
        <summary>
          <b>{label}</b>
        </summary>
        <pre
          ref={pre}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {lines.join('\n')}
        </pre>
      </details>
    </section>
  );
};
