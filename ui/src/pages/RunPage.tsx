import { Link, useParams } from 'react-router-dom';
import type { Meta, RunInfo } from '../api.ts';
import { useDialog } from '../components/Dialog.tsx';
import { RecordCard, StatusPill } from '../components/bits.tsx';
import { FnTitle } from '../components/FnTitle.tsx';
import { Log } from '../components/Log.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { duration, when } from '../lib/format.ts';
import { useNow } from '../lib/hooks.ts';
import { useMeta, useRecords, useRun, useStopRun } from '../queries.ts';

const shown = (value: string) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : value;
  } catch {
    return value;
  }
};

const Parameters = ({ run, meta }: { run: RunInfo; meta?: Meta }) => {
  const label = (name: string) => meta?.fields.find((f) => f.name === name)?.label ?? name;
  const rows = [...Object.entries(run.input ?? {}).map(([k, v]) => [label(k), shown(v)]), ['Browser', run.headed ? 'shown' : 'headless']];
  return (
    <details className="card fold">
      <summary>
        <b>Parameters</b> <span className="muted">{run.summary}</span>
      </summary>
      <div className="kv two gap-top">
        {rows.map(([k, v]) => (
          <div key={k} className="kv-row">
            <span className="k">{k}</span>
            <span className="v">{v.includes('\n') ? <pre>{v}</pre> : v}</span>
          </div>
        ))}
      </div>
    </details>
  );
};

export const RunPage = () => {
  const { id = '' } = useParams();
  const { data, error } = useRun(id);
  const { data: meta } = useMeta();
  const { data: records = [] } = useRecords();
  const stop = useStopRun();
  const { confirm, notify, dialog } = useDialog();
  const live = Boolean(data?.run.live);
  const now = useNow(live);

  if (error)
    return (
      <div className="empty">
        {error.message} <Link to="/history">Back to history</Link>
      </div>
    );
  if (!data) return <div className="empty">Loading…</div>;
  const { run, log } = data;
  const fn = meta?.functions.find((f) => f.id === run.project);

  const onStop = async () => {
    if (!(await confirm({ title: 'Stop this run?', body: 'Whatever DEV already accepted stays there.', ok: 'Stop', tone: 'danger' }))) return;
    try {
      await stop.mutateAsync();
    } catch (e) {
      await notify('Could not stop the run', (e as Error).message);
    }
  };

  return (
    <div className="focus">
      {dialog}
      <Link className="crumb" to="/history">
        ← History
      </Link>
      <div className="pagehead">
        <h1>
          <FnTitle title={run.title} />
        </h1>
        <StatusPill status={run.status} testId="run-status" />
        <span className="spacer" />
        {fn && !live && (
          <Link className="btn small" to={`/fn/${fn.id}?run=${run.id}`}>
            Run again
          </Link>
        )}
        {run.hasReport && (
          <a className="btn small" href={`/runs/${run.id}/report/`} target="_blank" rel="noreferrer" title="Screenshots, trace, errors">
            Playwright report ↗
          </a>
        )}
        {live && run.status !== 'stopping' && (
          <button type="button" className="btn danger small" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      <p className="lead">
        {when(run.startedAt)} · {duration((run.endedAt ?? now) - run.startedAt)}
        {run.summary ? ` · ${run.summary}` : ''}
      </p>
      <div className="stack">
        <section className="card">
          <Timeline tests={run.view?.tests ?? []} failures={run.view?.failures ?? []} status={run.status} live={live} now={now} />
        </section>
        {!live && (
          <section className="card">
            <h2 className="sub">Records made or updated</h2>
            {(run.records ?? []).length ? (
              run.records.map((r) => <RecordCard key={r.ref} made={r} meta={meta} full={records.find((x) => x.kind === r.kind && x.key === r.ref)} />)
            ) : (
              <div className="muted">None were written under out/records.</div>
            )}
          </section>
        )}
        <Log lines={log} live={live} />
        <Parameters run={run} meta={meta} />
      </div>
    </div>
  );
};
