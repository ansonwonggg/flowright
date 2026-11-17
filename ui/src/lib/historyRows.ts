import { isIf } from '../../../src/flow.ts';
import type { FlowRun, FlowRunStep, HistoryItem } from '../api.ts';

/** A function step of a flow run as History lists it under the flow. `run` is its latest go; absent when it never started or History no longer has it. */
export type FlowStepRow = { n: number; step: FlowRunStep; run?: HistoryItem };

/** One History row: a function run started on its own, or a flow run with its steps. */
export type HistoryRow = { kind: 'run'; run: HistoryItem } | { kind: 'flow'; flow: FlowRun; steps: FlowStepRow[] };

/** Which rows a History filter keeps: `failed` means anything that ended other than passed. */
export type HistoryFilter = { status: 'all' | 'passed' | 'failed'; query: string };

const runIdsOf = (flow: FlowRun): string[] => flow.steps.flatMap((s) => [s.runId, ...(s.tries ?? []).map((t) => t.runId)]).filter((id): id is string => Boolean(id));

const startOf = (row: HistoryRow) => (row.kind === 'run' ? row.run.startedAt : row.flow.startedAt);

/**
 * History as rows, newest first: each flow run once, with its function steps (IFs and skipped steps left
 * out), and every function run that no flow run claims. Runs from earlier tries of a step are claimed by
 * the flow but not listed; the flow run page shows them.
 */
export const historyRows = (runs: HistoryItem[], flows: FlowRun[]): HistoryRow[] => {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const claimed = new Set(flows.flatMap(runIdsOf));
  const flowRows: HistoryRow[] = flows.map((flow) => ({
    kind: 'flow',
    flow,
    steps: flow.steps.flatMap((step, i) => (isIf(step) || step.status === 'skipped' ? [] : [{ n: i + 1, step, run: step.runId ? byId.get(step.runId) : undefined }])),
  }));
  const loose: HistoryRow[] = runs.filter((r) => !claimed.has(r.id)).map((run) => ({ kind: 'run', run }));
  return [...flowRows, ...loose].sort((a, b) => startOf(b) - startOf(a));
};

const runText = (run: HistoryItem) =>
  `${run.title} ${run.summary} ${Object.values(run.input ?? {}).join(' ')} ${(run.records ?? []).map((r) => `${r.ref} ${r.summary}`).join(' ')}`;

const statusKept = (status: string, filter: HistoryFilter) => {
  if (filter.status === 'passed') return status === 'passed';
  if (filter.status === 'failed') return !['passed', 'running', 'stopping'].includes(status);
  return true;
};

const queryKept = (text: string, filter: HistoryFilter) => {
  const q = filter.query.trim().toLowerCase();
  return !q || text.toLowerCase().includes(q);
};

/** Whether a function run matches a History filter. The query matches function, parameters, inputs and records made. */
export const matchesHistory = (run: HistoryItem, filter: HistoryFilter): boolean => statusKept(run.status, filter) && queryKept(runText(run), filter);

/** Whether a History row matches a filter. A flow goes by its own status; the query matches its name and anything its steps' runs match. */
export const matchesRow = (row: HistoryRow, filter: HistoryFilter): boolean => {
  if (row.kind === 'run') return matchesHistory(row.run, filter);
  const text = [row.flow.name, ...row.steps.map((s) => `${s.step.title} ${s.run ? runText(s.run) : ''}`)].join(' ');
  return statusKept(row.flow.status, filter) && queryKept(text, filter);
};

/** Where a function run sits in a flow run. `latest` is false when it was an earlier try of the step, since retried. */
export type FlowPlace = { flow: FlowRun; n: number; title: string; latest: boolean };

/** The flow run step that ran as function run `runId`, checking earlier tries too; `undefined` when no flow run did. */
export const flowPlaceOf = (runId: string, flows: FlowRun[]): FlowPlace | undefined => {
  for (const flow of flows) {
    const i = flow.steps.findIndex((s) => s.runId === runId || (s.tries ?? []).some((t) => t.runId === runId));
    if (i >= 0) return { flow, n: i + 1, title: flow.steps[i].title, latest: flow.steps[i].runId === runId };
  }
  return undefined;
};
