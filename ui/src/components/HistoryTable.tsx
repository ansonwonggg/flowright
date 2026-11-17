import { useState } from 'react';
import type { HistoryItem } from '../api.ts';
import { duration, when } from '../lib/format.ts';
import type { FlowStepRow, HistoryRow } from '../lib/historyRows.ts';
import { EnvChip, StatusPill } from './bits.tsx';
import { FnTitle } from './FnTitle.tsx';
import { RetryButton } from './RetryButton.tsx';

type Opens = { onOpenRun: (runId: string, flowId?: string) => void; onOpenFlow: (flowId: string) => void };

const Made = ({ runs }: { runs: (HistoryItem | undefined)[] }) => {
  const refs = new Map(runs.flatMap((r) => r?.records ?? []).map((x) => [x.ref, x]));
  return (
    <>
      {[...refs.values()].map((x) => (
        <span key={x.ref} className="chip mono" title={x.summary}>
          {x.ref}
        </span>
      ))}
    </>
  );
};

const Took = ({ from, to }: { from: number; to?: number }) => <td className="muted">{to ? duration(to - from) : ''}</td>;

const RunRow = ({ r, onOpenRun }: { r: HistoryItem } & Pick<Opens, 'onOpenRun'>) => (
  <tr className="click" onClick={() => onOpenRun(r.id)}>
    <td className="muted nowrap">{when(r.startedAt)}</td>
    <td className="nowrap">
      <b>
        <FnTitle title={r.title} />
      </b>
      {r.env && (
        <>
          {' '}
          <EnvChip env={r.env} />
        </>
      )}
    </td>
    <td>
      {r.summary}
      {r.view?.failures?.[0] && <div className="hint bad-text">✗ {r.view.failures[0].title}</div>}
    </td>
    <td>
      <StatusPill status={r.status} />
    </td>
    <Took from={r.startedAt} to={r.endedAt} />
    <td>
      <Made runs={[r]} />
    </td>
  </tr>
);

const StepRow = ({ s, flowId, onOpenRun }: { s: FlowStepRow; flowId: string } & Pick<Opens, 'onOpenRun'>) => {
  const { run } = s;
  return (
    <tr className={`step-row${run ? ' click' : ''}`} onClick={run ? () => onOpenRun(run.id, flowId) : undefined}>
      <td className="muted nowrap">{run ? when(run.startedAt) : ''}</td>
      <td className="nowrap step-cell">
        <span className="muted">Step {s.n}</span> <FnTitle title={s.step.title} />
        {(s.step.tries?.length ?? 0) > 0 && (
          <>
            {' '}
            <span className="chip try">try {(s.step.tries?.length ?? 0) + 1}</span>
          </>
        )}
      </td>
      <td>
        {run?.summary}
        {s.step.error && <div className="hint bad-text">✗ {s.step.error}</div>}
      </td>
      <td>
        <StatusPill status={s.step.status} />
      </td>
      {run ? <Took from={run.startedAt} to={run.endedAt} /> : <td />}
      <td>
        <Made runs={[run]} />
      </td>
    </tr>
  );
};

const FlowRows = ({ row, onOpenRun, onOpenFlow }: { row: Extract<HistoryRow, { kind: 'flow' }> } & Opens) => {
  const [open, setOpen] = useState(false);
  const { flow, steps } = row;
  const failed = steps.find((s) => s.step.status === 'failed' || s.step.status === 'stopped');
  const passed = steps.filter((s) => s.step.status === 'passed').length;
  return (
    <>
      <tr className="click flow-row" onClick={() => onOpenFlow(flow.id)}>
        <td className="muted nowrap">{when(flow.startedAt)}</td>
        <td className="nowrap">
          <button
            type="button"
            className="btn small expander"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} steps of ${flow.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            {open ? '▾' : '▸'}
          </button>{' '}
          <b>{flow.name}</b> <span className="chip">flow</span>
          {flow.env && (
            <>
              {' '}
              <EnvChip env={flow.env} />
            </>
          )}
        </td>
        <td>
          <span className="muted">
            {passed}/{steps.length} steps passed
          </span>
          {failed && (
            <div className="hint bad-text">
              ✗ Step {failed.n} {failed.step.title}
              {failed.step.error ? `: ${failed.step.error}` : ''}
            </div>
          )}
        </td>
        <td>
          <StatusPill status={flow.status} />
          <span className="retry-cell" onClick={(e) => e.stopPropagation()}>
            <RetryButton run={flow} onRetried={() => onOpenFlow(flow.id)} />
          </span>
        </td>
        <Took from={flow.startedAt} to={flow.endedAt} />
        <td>
          <Made runs={steps.map((s) => s.run)} />
        </td>
      </tr>
      {open && steps.map((s) => <StepRow key={s.n} s={s} flowId={flow.id} onOpenRun={onOpenRun} />)}
    </>
  );
};

/**
 * History as a table: a function run per row, and a flow run as one row whose ▸ shows its steps.
 * A failed or stopped flow has its Retry button in the row.
 *
 * @param rows - from `historyRows`, in the order to show them.
 * @param onOpenRun - a function run row or a step row was clicked; `flowId` is set for a step of a flow run.
 * @param onOpenFlow - a flow row was clicked, or its retry was accepted.
 */
export const HistoryTable = ({ rows, onOpenRun, onOpenFlow }: { rows: HistoryRow[] } & Opens) => (
  <table>
    <thead>
      <tr>
        <th>Started</th>
        <th>Run</th>
        <th>Parameters</th>
        <th>Result</th>
        <th>Took</th>
        <th>Made</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) =>
        row.kind === 'run' ? (
          <RunRow key={row.run.id} r={row.run} onOpenRun={onOpenRun} />
        ) : (
          <FlowRows key={row.flow.id} row={row} onOpenRun={onOpenRun} onOpenFlow={onOpenFlow} />
        ),
      )}
    </tbody>
  </table>
);
