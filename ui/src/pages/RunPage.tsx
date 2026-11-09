import { Link, useParams } from 'react-router-dom';
import type { Fn, Meta, RunInfo } from '../api.ts';
import { useDialog } from '../components/Dialog.tsx';
import { RecordCard, StatusPill } from '../components/bits.tsx';
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

const Parameters = ({ run, fn, meta }: { run: RunInfo; fn?: Fn; meta?: Meta }) => {
  const label = (name: string) => meta?.fields.find((f) => f.name === name)?.label ?? name;
  const rows = [...Object.entries(run.input ?? {}).map(([k, v]) => [label(k), shown(v)]), ['Browser', run.headed ? 'shown' : 'headless']];
  const again = fn ? `/fn/${fn.id}?run=${run.id}` : undefined;
  return (
    <section>
      <div className="inline between">
        <b>Parameters</b>
        {again && (
          <Link className="btn small" to={again}>
            Run again →
          </Link>
        )}
      </div>
      <div className="gap">{run.summary}</div>
      <div className="kv two">
        {rows.map(([k, v]) => (
          <div key={k} className="kv-row">
            <span className="k">{k}</span>
            <span className="v">{v.includes('\n') ? <pre>{v}</pre> : v}</span>
          </div>
        ))}
      </div>
    </section>
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
    <>
      {dialog}
      <Link className="crumb" to="/history">
        ← History
      </Link>
      <div className="runhead">
        <h1>{run.title}</h1>
        <StatusPill status={run.status} testId="run-status" />
        <span className="muted">
          {when(run.startedAt)} · {duration((run.endedAt ?? now) - run.startedAt)}
        </span>
        <span className="spacer" />
        {live && run.status !== 'stopping' && (
          <button type="button" className="btn danger small" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      <div className="grid2 gap-top">
        <div>
          <section>
            <Timeline tests={run.view?.tests ?? []} failures={run.view?.failures ?? []} status={run.status} live={live} now={now} />
          </section>
          {!live && (
            <section>
              <b>Records made or updated</b>
              {(run.records ?? []).length ? (
                run.records.map((r) => <RecordCard key={r.ref} made={r} meta={meta} full={records.find((x) => x.kind === r.kind && x.key === r.ref)} />)
              ) : (
                <div className="muted gap-top">None were written under out/records.</div>
              )}
            </section>
          )}
          <Log lines={log} live={live} />
        </div>
        <div className="side">
          <Parameters run={run} fn={fn} meta={meta} />
          {run.hasReport ? (
            <a className="btn center" href={`/runs/${run.id}/report/`} target="_blank" rel="noreferrer">
              Open Playwright report ↗<div className="hint">screenshots, trace, errors</div>
            </a>
          ) : (
            !live && <div className="muted small">No Playwright report was kept for this run.</div>
          )}
        </div>
      </div>
    </>
  );
};
