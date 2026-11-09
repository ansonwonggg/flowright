import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { HistoryItem, Meta, RecordRow, ShownStatus } from '../api.ts';
import { duration, when, who } from '../lib/format.ts';

/** A run's status as a coloured pill. `testId` lets tests find the one on the run page. */
export const StatusPill = ({ status, testId }: { status: ShownStatus; testId?: string }) => (
  <span className={`pill ${status}`} data-testid={testId}>
    {status}
  </span>
);

/** A record stage as a chip: green when no function is left to run on it, amber otherwise. */
export const StageChip = ({ done, label }: { done: boolean; label: string }) => <span className={`chip ${done ? 'done' : 'todo'}`}>{label}</span>;

/** A record kind in words, from the kit's settings; the kind itself when there is no label or no meta yet. */
export const kindLabel = (kind: string, meta: Pick<Meta, 'settings'> | undefined): string => meta?.settings.records[kind]?.label ?? kind;

/** Copies `text` to the clipboard and says "Copied" for a moment. */
export const CopyButton = ({ text, label = 'Copy' }: { text: string; label?: string }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1500);
  };
  return (
    <button type="button" className="btn small" onClick={copy}>
      {state === 'idle' ? label : state === 'copied' ? 'Copied' : 'Copy failed'}
    </button>
  );
};

/** The "Next: <function> →" links for a record; nothing when every function has run on it. */
export const NextLinks = ({ record }: { record: Pick<RecordRow, 'key' | 'next'> }) =>
  record.next.length ? (
    <div className="next">
      {record.next.map((n) => (
        <Link key={n.id} className="btn small" to={`/fn/${n.id}?ref=${encodeURIComponent(record.key)}`}>
          Next: {n.title} →
        </Link>
      ))}
    </div>
  ) : null;

/**
 * A record a run made or changed, with its login (copyable) and next stages. `full` is its current state,
 * when known; `meta` names its kind.
 */
export const RecordCard = ({ made, full, meta }: { made: { kind: string; ref: string; stage: string; stageLabel: string; summary: string }; full?: RecordRow; meta?: Pick<Meta, 'settings'> }) => {
  const login = (full?.details ?? []).filter(([k]) => k === 'Username' || k === 'Password');
  return (
    <div className="rec">
      <div className="top">
        <span className="chip">{kindLabel(made.kind, meta)}</span>
        <span className="mono strong">{made.ref}</span>
        <StageChip done={full ? !full.next.length : false} label={full?.stageLabel ?? made.stageLabel} />
        <CopyButton text={made.ref} label="Copy ref" />
      </div>
      <div className="muted gap-top">{who(made.summary, made.ref)}</div>
      {login.map(([k, v]) => (
        <div key={k} className="gap-top">
          <span className="muted">{k}</span> <span className="mono">{v}</span> <CopyButton text={v} />
        </div>
      ))}
      {full && <NextLinks record={full} />}
    </div>
  );
};

/** Runs as a table; a row opens that run. */
export const HistoryTable = ({ runs, onOpen }: { runs: HistoryItem[]; onOpen: (id: string) => void }) => (
  <table>
    <thead>
      <tr>
        <th>Started</th>
        <th>Function</th>
        <th>Parameters</th>
        <th>Result</th>
        <th>Took</th>
        <th>Made</th>
      </tr>
    </thead>
    <tbody>
      {runs.map((r) => (
        <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
          <td className="muted nowrap">{when(r.startedAt)}</td>
          <td className="nowrap">
            <b>{r.title}</b>
          </td>
          <td>
            {r.summary}
            {r.view?.failures?.[0] && <div className="hint bad-text">✗ {r.view.failures[0].title}</div>}
          </td>
          <td>
            <StatusPill status={r.status} />
          </td>
          <td className="muted">{r.endedAt ? duration(r.endedAt - r.startedAt) : ''}</td>
          <td>
            {(r.records ?? []).map((x) => (
              <span key={x.ref} className="chip mono" title={x.summary}>
                {x.ref}
              </span>
            ))}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);
