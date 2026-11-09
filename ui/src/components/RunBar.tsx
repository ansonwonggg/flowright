import type { ReactNode } from 'react';

/** Props of {@link RunBar}. */
export type RunBarProps = {
  /** Blocking problems from the input check. Any of them shows "Fix before running" with the list. */
  problems: string[];
  /** Non-blocking notes shown above the bar, e.g. another run in progress or a missing `.env.local` value. */
  notes?: ReactNode[];
  /** The check is still in flight: the status says "Checking…" instead of ready. */
  checking: boolean;
  /** What the status says when there are no problems, e.g. "Ready to run". */
  ready: string;
  /** Small text under the ready status, e.g. how many inputs come from the record. */
  readyHint?: ReactNode;
  /** Whether "Show the browser while it runs" is ticked. */
  headed: boolean;
  /** Called with the new tick state; the caller stores the preference. */
  onHeaded: (headed: boolean) => void;
  /** The bar's buttons, primary last. The caller decides when they are disabled. */
  children: ReactNode;
};

/**
 * The bar pinned to the bottom of a run form: check status on the left, the browser toggle and the
 * buttons on the right. Notes and problems stack just above it, so they stay in view while the form
 * scrolls.
 */
export const RunBar = ({ problems, notes = [], checking, ready, readyHint, headed, onHeaded, children }: RunBarProps) => {
  const status = problems.length ? 'bad' : checking ? 'wait' : 'ok';
  return (
    <div className="runbar" role="region" aria-label="Run">
      <div className="runbar-in">
        {(notes.length > 0 || problems.length > 0) && (
          <div className="runbar-notes">
            {notes.map((note, i) => (
              <div key={i} className="box warn">
                {note}
              </div>
            ))}
            {problems.length > 0 && (
              <div className="box bad">
                <b>Fix before running</b>
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="runbar-row">
          <div className={`runbar-status ${status}`}>
            <span className="dot" />
            <span>
              {problems.length ? `${problems.length} to fix` : checking ? 'Checking…' : `✓ ${ready}`}
              {status === 'ok' && readyHint && <span className="hint"> · {readyHint}</span>}
            </span>
          </div>
          <span className="spacer" />
          <label className="check toggle">
            <input type="checkbox" checked={headed} onChange={(e) => onHeaded(e.target.checked)} />
            <span className="knob" aria-hidden="true" />
            Show the browser while it runs
          </label>
          {children}
        </div>
      </div>
    </div>
  );
};
