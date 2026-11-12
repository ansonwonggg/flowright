import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Meta, RunInfo } from '../api.ts';
import { RecordCard } from '../components/bits.tsx';
import { FnTitle } from '../components/FnTitle.tsx';
import { Log } from '../components/Log.tsx';
import { RunHead } from '../components/RunHead.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { Values } from '../components/Values.tsx';
import { duration, when } from '../lib/format.ts';
import { useNow } from '../lib/hooks.ts';
import { useFlowRun, useMeta, useRecords, useRun } from '../queries.ts';

const Parameters = ({ run, meta }: { run: RunInfo; meta?: Meta }) => {
  const label = (name: string) => meta?.fields.find((f) => f.name === name)?.label ?? name;
  return (
    <details className="card fold">
      <summary>
        <b>Parameters</b> <span className="muted">{run.summary}</span>
      </summary>
      <div className="gap-top">
        <Values values={run.input} label="Parameters" nameOf={label} />
        <div className="muted gap-top">
          Browser: <span>{run.headed ? 'shown' : 'headless'}</span>
        </div>
      </div>
    </details>
  );
};

const useBack = (): { to: string; label: string } => {
  const [params] = useSearchParams();
  const flowId = params.get('flow') ?? '';
  const { data: flow } = useFlowRun(flowId);
  if (!flowId) return { to: '/history', label: 'History' };
  return { to: `/flow-run/${flowId}`, label: flow?.name || 'Flow run' };
};

export const RunPage = () => {
  const { id = '' } = useParams();
  const { data, error } = useRun(id);
  const { data: meta } = useMeta();
  const { data: records = [] } = useRecords();
  const back = useBack();
  const live = Boolean(data?.run.live);
  const now = useNow(live);

  if (error)
    return (
      <div className="empty">
        {error.message} <Link to={back.to}>Back to {back.label}</Link>
      </div>
    );
  if (!data) return <div className="empty">Loading…</div>;
  const { run, log } = data;
  const fn = meta?.functions.find((f) => f.id === run.project);

  return (
    <div className="focus">
      <RunHead
        back={back}
        title={<FnTitle title={run.title} />}
        status={run.status}
        statusTestId="run-status"
        rerunTo={fn && !live ? `/fn/${fn.id}?run=${run.id}` : undefined}
        reportOf={run.hasReport ? run.id : undefined}
        stoppable={live && run.status !== 'stopping'}
        env={run.env}
      />
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
