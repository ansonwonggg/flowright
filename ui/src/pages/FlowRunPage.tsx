import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { conditionText, isIf } from '../../../src/flow.ts';
import type { FlowRun, FlowRunStep } from '../api.ts';
import { pillOf, ReportLink, StatusPill } from '../components/bits.tsx';
import { FlowCanvas } from '../components/FlowCanvas.tsx';
import { FnTitle } from '../components/FnTitle.tsx';
import { Log } from '../components/Log.tsx';
import { Menu, type MenuItem } from '../components/Menu.tsx';
import { RunHead } from '../components/RunHead.tsx';
import { Values } from '../components/Values.tsx';
import { autoSelected } from '../lib/canvas.ts';
import { duration, when } from '../lib/format.ts';
import { readPref, writePref } from '../lib/hooks.ts';
import { useFlowRun, useRun } from '../queries.ts';

const IfDetail = ({ step, steps }: { step: FlowRunStep; steps: FlowRun['steps'] }) => {
  if (!isIf(step)) return null;
  const [name, value] = Object.entries(step.input ?? {})[0] ?? [step.if.value, undefined];
  const n = steps.indexOf(step);
  const count = (arm: 'then' | 'else') => steps.filter((s) => !isIf(s) && s.branch?.at === n && s.branch.arm === arm).length;
  return (
    <div className="gap-top if-detail">
      <div>
        Tests <b>{conditionText(step.if)}</b>. True runs {count('then')} step{count('then') === 1 ? '' : 's'}, false runs {count('else')}.
      </div>
      {step.taken && (
        <div className={`box ${step.taken === 'then' ? 'ok' : 'note'} gap-top`} data-testid="if-result">
          {name} was {value ? <code>{value}</code> : 'empty'}, so the flow took the <b>{step.taken === 'then' ? 'true' : 'false'}</b> branch.
        </div>
      )}
    </div>
  );
};

const SkipNote = ({ step, steps }: { step: FlowRunStep; steps: FlowRun['steps'] }) => {
  if (isIf(step) || !step.branch) return null;
  const at = step.branch.at;
  return (
    <div className="muted gap-top">
      Skipped: step {at + 1} ({steps[at]?.title}) took the {step.branch.arm === 'then' ? 'false' : 'true'} branch.
    </div>
  );
};

/**
 * One flow step's details: title, status, Report ↗ and ⋯ menu, then its error, input (behind the
 * menu), output and log; an IF shows what it tested and which branch it took, a skipped step why.
 */
const StepDetail = ({ step, n, steps, flowId }: { step: FlowRunStep; n: number; steps: FlowRun['steps']; flowId: string }) => {
  const [showInput, setShowInput] = useState(false);
  const [logChoice, setLogChoice] = useState<boolean>();
  const running = step.status === 'running';
  const ended = step.status === 'failed' || step.status === 'stopped';
  const logShown = Boolean(step.runId) && (logChoice ?? (running || ended));
  const items: MenuItem[] =
    step.status === 'waiting' || step.status === 'skipped' || isIf(step)
      ? []
      : [
          { label: 'Input', checked: showInput, onSelect: () => setShowInput(!showInput) },
          ...(step.runId
            ? [
                { label: 'Log', checked: logShown, onSelect: () => setLogChoice(!logShown) },
                { label: 'Open in History', to: `/run/${step.runId}?flow=${encodeURIComponent(flowId)}` },
              ]
            : []),
        ];
  return (
    <>
      <div className="card-head">
        <span className="st-title">{isIf(step) ? step.title : <FnTitle title={step.title} />}</span>
        <span className="spacer" />
        <span className="inline">
          <StatusPill status={step.status} testId={`step-${n}-status`} />
          {(step.status === 'passed' || ended) && step.runId && <StepReport runId={step.runId} />}
          {items.length > 0 && <Menu label={`Step ${n} options`} items={items} />}
        </span>
      </div>
      <IfDetail step={step} steps={steps} />
      {step.status === 'skipped' && <SkipNote step={step} steps={steps} />}
      {step.error && <div className="box bad gap-top">{step.error}</div>}
      {showInput && (
        <div className="gap-top">
          <h3 className="sub">Input</h3>
          <Values values={step.input} label={`Step ${n} input`} />
        </div>
      )}
      {step.status === 'passed' && !isIf(step) && (
        <div className="gap-top">
          <h3 className="sub">Output</h3>
          <Values values={step.output} label={`Step ${n} output`} />
        </div>
      )}
      {logShown && step.runId && <StepLog runId={step.runId} open={running || ended || logChoice === true} label={`Step ${n} log`} />}
    </>
  );
};

const dotOf = (step: FlowRunStep, n: number) => {
  if (step.status === 'running') return <span className="spin">◐</span>;
  if (isIf(step)) return step.taken ? (step.taken === 'then' ? 'T' : 'F') : '?';
  return { passed: '✓', failed: '✗', stopped: '✗', skipped: '↷' }[step.status as string] ?? n;
};

const StepRow = ({ step, n, steps, flowId }: { step: FlowRunStep; n: number; steps: FlowRun['steps']; flowId: string }) => (
  <li aria-label={`Step ${n}`} className={`st-${pillOf(step.status) || step.status}${!isIf(step) && step.branch ? ' st-arm' : ''}`}>
    <span className="st-dot" aria-hidden="true">
      {dotOf(step, n)}
    </span>
    <div className="st-body">
      <StepDetail step={step} n={n} steps={steps} flowId={flowId} />
    </div>
  </li>
);

const StepReport = ({ runId }: { runId: string }) => {
  const { data } = useRun(runId);
  return data?.run?.hasReport ? <ReportLink runId={runId} /> : null;
};

const StepLog = ({ runId, open, label }: { runId: string; open: boolean; label: string }) => {
  const { data, error } = useRun(runId);
  if (error) return <div className="muted gap-top">No log: {error.message}</div>;
  return <Log lines={data?.log ?? []} live={open} label={label} />;
};

/**
 * A flow run's steps as a list, laid out flat (an IF, then its arms, indented). A running step shows its
 * live log; a passed one its output; a failed or stopped one its error and log. A finished step links to
 * its Playwright report when one was kept. Each started step's ⋯ menu shows its input, toggles its log,
 * and links to its run in History. An IF says which branch it took; a skipped step why.
 */
export const Steps = ({ run }: { run: FlowRun }) => (
  <ol className="stepper">
    {run.steps.map((s, i) => (
      <StepRow key={i} step={s} n={i + 1} steps={run.steps} flowId={run.id} />
    ))}
  </ol>
);

type View = 'canvas' | 'list';

/**
 * A flow run as a canvas with the selected node's details under it. The selection follows the run (the
 * running step, else where it ended) until a node is clicked.
 */
export const RunCanvas = ({ run }: { run: FlowRun }) => {
  const [picked, setPicked] = useState<number>();
  const selected = picked ?? autoSelected(run);
  const step = run.steps[selected];
  return (
    <>
      <FlowCanvas run={run} selected={selected} onSelect={setPicked} />
      {step && (
        <section className={`cv-detail st-${pillOf(step.status) || step.status}`} aria-label={`Step ${selected + 1} details`}>
          <div className="cv-detail-no">Step {selected + 1}</div>
          <StepDetail key={selected} step={step} n={selected + 1} steps={run.steps} flowId={run.id} />
        </section>
      )}
    </>
  );
};

export const FlowRunPage = () => {
  const { id = '' } = useParams();
  const { data: run, error, isPending } = useFlowRun(id);
  const [view, setView] = useState<View>(() => (readPref('flowView') === 'list' ? 'list' : 'canvas'));
  if (isPending) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty">{error.message}</div>;
  return (
    <div className={`focus${view === 'canvas' ? ' wide' : ''}`}>
      <RunHead
        back={{ to: '/flows', label: 'Flows' }}
        title={run.name}
        status={run.status}
        statusTestId="flow-status"
        rerunTo={run.status === 'running' ? undefined : `/flow-builder?run=${encodeURIComponent(run.id)}`}
        stoppable={run.status === 'running'}
        env={run.env}
      >
        <div className="modes" role="radiogroup" aria-label="View">
          {(
            [
              ['canvas', 'Canvas'],
              ['list', 'List'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={view === value}
              className={`btn small${view === value ? ' on' : ''}`}
              onClick={() => {
                setView(value);
                writePref('flowView', value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </RunHead>
      <p className="lead">
        Started {when(run.startedAt)}
        {run.endedAt ? ` · took ${duration(run.endedAt - run.startedAt)}` : ''}. Each step is its own run in History.
      </p>
      {view === 'canvas' ? <RunCanvas run={run} /> : <Steps run={run} />}
      <details className="card fold">
        <summary>
          <b>Values passed along</b> <span className="muted">{Object.keys(run.values ?? {}).length}</span>
        </summary>
        <div className="gap-top">
          <Values values={run.values} label="Values passed along" />
        </div>
      </details>
    </div>
  );
};
