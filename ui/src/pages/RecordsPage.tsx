import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { CopyButton, NextLinks, StageChip, StatusPill } from '../components/bits.tsx';
import { FnTitle } from '../components/FnTitle.tsx';
import { groupByFunction, type FunctionGroup, type FunctionRow } from '../lib/byFunction.ts';
import { when, who } from '../lib/format.ts';
import { useHistory, useMeta, useRecords, useRun } from '../queries.ts';

const RunLog = ({ id }: { id: string }) => {
  const { data, isPending, error } = useRun(id);
  if (isPending) return <div className="muted">Loading the log…</div>;
  if (error) return <div className="muted">{error.message}</div>;
  return data.log.length ? <pre className="log-pre">{data.log.join('\n')}</pre> : <div className="muted">This run kept no log.</div>;
};

const Output = ({ row: { made, current } }: { row: FunctionRow }) => {
  if (!current && made)
    return (
      <div className="muted">
        {made.ref} · {made.stageLabel}. The record is no longer under out/records.
      </div>
    );
  if (!current) return <div className="muted">Nothing was saved under out/records.</div>;
  return (
    <>
      <div className="kv">
        {current.details.map(([k, v]) => (
          <div key={k} className="kv-row">
            <span className="k">{k}</span>
            <span className="v">{v}</span>
            <CopyButton text={v} />
          </div>
        ))}
      </div>
      {made && made.stage !== current.stage && <div className="hint">After this run it was {made.stageLabel}; it has moved on since.</div>}
      <NextLinks record={current} />
    </>
  );
};

const Detail = ({ row }: { row: FunctionRow }) => {
  const { run } = row;
  const params = [...Object.entries(run.input ?? {}), ['Browser', run.headed ? 'shown' : 'headless']].filter(([, v]) => v);
  const failure = run.view?.failures?.[0];
  return (
    <div className="detail-grid">
      <div>
        <h3>Parameters</h3>
        <div className="gap">{run.summary}</div>
        <div className="kv two">
          {params.map(([k, v]) => (
            <div key={k} className="kv-row">
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3>Output</h3>
        <Output row={row} />
        {failure && (
          <div className="failure">
            <div className="ft">✗ {failure.title}</div>
            {failure.step && <div className="muted">{failure.step}</div>}
            <div className="gap">{failure.hint}</div>
          </div>
        )}
      </div>
      <div className="span2">
        <div className="inline between">
          <h3>Log</h3>
          <span className="inline">
            {run.hasReport && (
              <a className="btn small" href={`/runs/${run.id}/report/`} target="_blank" rel="noreferrer">
                Playwright report ↗
              </a>
            )}
            <Link className="btn small" to={`/run/${run.id}`}>
              Open run →
            </Link>
          </span>
        </div>
        <RunLog id={run.id} />
      </div>
    </div>
  );
};

/** One function's section: a header that folds it, and a row per record its runs made or moved on. */
export const FunctionSection = ({ group, open, onToggle }: { group: FunctionGroup; open: string | null; onToggle: (key: string) => void }) => {
  const [folded, setFolded] = useState(false);
  const { fn, rows, passed, failed } = group;
  return (
    <section className="tight fn">
      <button type="button" className="fn-head" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
        <span className="chev">{folded ? '▸' : '▾'}</span>
        <span className="fn-title">
          <FnTitle title={fn.title} />
        </span>
        <span className="muted small">{fn.detail}</span>
        <span className="spacer" />
        <span className="chip done">✓ {passed}</span>
        {failed > 0 && <span className="chip bad-chip">✗ {failed}</span>}
      </button>
      {!folded && (
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Who</th>
              <th>Result</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.key}>
                <tr className="click" aria-expanded={open === row.key} onClick={() => onToggle(row.key)}>
                  <td className="nowrap mono">{row.made?.ref ?? '—'}</td>
                  <td>
                    {row.made ? who(row.made.summary, row.made.ref) : <span className="muted">nothing saved</span>}
                    {row.current && (
                      <>
                        {' '}
                        <StageChip done={!row.current.next.length} label={row.current.stageLabel} />
                      </>
                    )}
                  </td>
                  <td>
                    <StatusPill status={row.run.status} />
                  </td>
                  <td className="muted nowrap">{when(row.run.startedAt)}</td>
                </tr>
                {open === row.key && (
                  <tr className="detail">
                    <td colSpan={4}>
                      <Detail row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export const RecordsPage = () => {
  const { data: meta } = useMeta();
  const { data: history = [] } = useHistory();
  const { data: records = [] } = useRecords();
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const groups = meta ? groupByFunction(meta.functions, history, records, kind, query) : [];
  return (
    <div className="wide-page">
      <h1>Records</h1>
      <p className="lead">What each function made, newest first. Open a row for its parameters, output and log.</p>
      <div className="filters">
        <div className="seg">
          {[['all', 'All'], ...Object.entries(meta?.settings.records ?? {}).map(([k, r]) => [k, `${r.label[0].toUpperCase()}${r.label.slice(1)}s`])].map(([k, label]) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search records" placeholder="Search ref, name, username, company, parameters…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {groups.length ? (
        groups.map((g) => <FunctionSection key={g.fn.id} group={g} open={open} onToggle={(key) => setOpen(open === key ? null : key)} />)
      ) : (
        <div className="empty">{history.length ? 'No records match.' : 'Nothing yet. Records appear here once a flow has run.'}</div>
      )}
    </div>
  );
};
