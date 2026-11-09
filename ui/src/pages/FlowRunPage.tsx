import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FlowRun, FlowRunStep } from '../api.ts';
import { CopyButton } from '../components/bits.tsx';
import { Log } from '../components/Log.tsx';
import { Menu, type MenuItem } from '../components/Menu.tsx';
import { duration, when } from '../lib/format.ts';
import { useFlowRun, useRun, useStopRun } from '../queries.ts';

/** The pill class for a flow or step status, reusing the run colours. */
export const pillOf = (status: string): string => ({ stopped: 'interrupted', waiting: '' })[status] ?? status;

const Values = ({ values, label }: { values?: Record<string, string>; label: string }) => {
  const rows = Object.entries(values ?? {});
  if (!rows.length) return <div className="muted">—</div>;
  return (
    <div className="kv" aria-label={label}>
      {rows.map(([k, v]) => (
        <div key={k} className="kv-row">
          <span className="k mono">{k}</span>
          <span className="v">{v}</span>
          <CopyButton text={v} />
        </div>
      ))}
    </div>
  );
};

const StepRow = ({ step, n }: { step: FlowRunStep; n: number }) => {
  const [showInput, setShowInput] = useState(false);
  const [logChoice, setLogChoice] = useState<boolean>();
  const running = step.status === 'running';
  const ended = step.status === 'failed' || step.status === 'stopped';
  const logShown = Boolean(step.runId) && (logChoice ?? (running || ended));
  const items: MenuItem[] =
    step.status === 'waiting'
      ? []
      : [
          { label: 'Input', checked: showInput, onSelect: () => setShowInput(!showInput) },
          ...(step.runId
            ? [
                { label: 'Log', checked: logShown, onSelect: () => setLogChoice(!logShown) },
                { label: 'Open in History', to: `/run/${step.runId}` },
              ]
            : []),
        ];
  return (
    <li aria-label={`Step ${n}`}>
      <div className="inline between">
        <span>
          <span className="step-no">{n}</span> <b>{step.title}</b>
        </span>
        <span className="inline">
          <span className={`pill ${pillOf(step.status)}`} data-testid={`step-${n}-status`}>
            {step.status}
          </span>
          {(step.status === 'passed' || ended) && step.runId && <StepReport runId={step.runId} />}
          <Menu label={`Step ${n} options`} items={items} />
        </span>
      </div>
      {step.error && <div className="box bad gap-top">{step.error}</div>}
      {showInput && (
        <div className="gap-top">
          <h3>Input</h3>
          <Values values={step.input} label={`Step ${n} input`} />
        </div>
      )}
      {step.status === 'passed' && (
        <div className="gap-top">
          <h3>Output</h3>
          <Values values={step.output} label={`Step ${n} output`} />
        </div>
      )}
      {logShown && step.runId && <StepLog runId={step.runId} open={running || ended || logChoice === true} label={`Step ${n} log`} />}
    </li>
  );
};

const StepReport = ({ runId }: { runId: string }) => {
  const { data } = useRun(runId);
  if (!data?.run?.hasReport) return null;
  return (
    <a className="btn small" href={`/runs/${encodeURIComponent(runId)}/report/`} target="_blank" rel="noreferrer" title="Playwright report: screenshots, trace, errors">
      Report ↗
    </a>
  );
};

const StepLog = ({ runId, open, label }: { runId: string; open: boolean; label: string }) => {
  const { data, error } = useRun(runId);
  if (error) return <div className="muted gap-top">No log: {error.message}</div>;
  return <Log lines={data?.log ?? []} live={open} label={label} />;
};

/**
 * A flow run's steps with their status. A running step shows its live log; a passed one its output; a
 * failed or stopped one its error and log. A finished step links to its Playwright report when one was
 * kept. Each started step's ⋯ menu shows its input, toggles its log, and links to its run in History.
 */
export const Steps = ({ run }: { run: FlowRun }) => (
  <ol className="chain-run">
    {run.steps.map((s, i) => (
      <StepRow key={`${i}-${s.function}`} step={s} n={i + 1} />
    ))}
  </ol>
);

export const FlowRunPage = () => {
  const { id = '' } = useParams();
  const { data: run, error, isPending } = useFlowRun(id);
  const stop = useStopRun();
  if (isPending) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty">{error.message}</div>;
  return (
    <>
      <Link className="crumb" to="/flows">
        ← Flows
      </Link>
      <div className="runhead">
        <h1>{run.name}</h1>
        <span className={`pill ${pillOf(run.status)}`} data-testid="flow-status">
          {run.status}
        </span>
        {run.status === 'running' && (
          <button type="button" className="btn" onClick={() => stop.mutate()}>
            Stop
          </button>
        )}
      </div>
      <p className="lead">
        Started {when(run.startedAt)}
        {run.endedAt ? ` · took ${duration(run.endedAt - run.startedAt)}` : ''}. Each step is its own run in History.
      </p>
      <Steps run={run} />
      <h2>Values passed along</h2>
      <section className="panel">
        <Values values={run.values} label="Values passed along" />
      </section>
    </>
  );
};
