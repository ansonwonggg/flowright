import { describe, expect, it } from 'vitest';
import type { FlowRun } from '../api.ts';
import { run } from './fixtures.test-utils.ts';
import { flowPlaceOf, historyRows, matchesHistory, matchesRow, type HistoryRow } from './historyRows.ts';

const A = '20261105-120000-aaaa';
const B = '20261105-120100-bbbb';
const C = '20261105-120200-cccc';
const OLD_TRY = '20261105-120150-dddd';
const LOOSE = '20261105-130000-eeee';

const flow = (over: Partial<FlowRun> = {}): FlowRun => ({
  id: '20261105-115959-ffff',
  name: 'New ER user',
  startedAt: 1_000,
  status: 'failed',
  values: {},
  steps: [
    { function: 'create-user', title: '[Web] Create ER User', status: 'passed', runId: A },
    { if: { value: 'status', equals: 'NEEDS_DDE' }, title: 'IF status', status: 'passed', taken: 'then' },
    { function: 'vet-datamod', title: '[Admin] Vet', status: 'failed', runId: C, branch: { at: 1, arm: 'then' }, tries: [{ status: 'failed', runId: OLD_TRY }] },
    { function: 'activate-api', title: '[API] Activate', status: 'skipped', branch: { at: 1, arm: 'else' } },
    { function: 'member-register', title: '[Web] Register', status: 'waiting' },
  ],
  ...over,
});

const runs = [
  run({ id: LOOSE, startedAt: 5_000, title: '[Web] Enrol' }),
  run({ id: C, startedAt: 3_000, title: '[Admin] Vet', status: 'failed' }),
  run({ id: OLD_TRY, startedAt: 2_500, title: '[Admin] Vet', status: 'failed' }),
  run({ id: A, startedAt: 1_000, title: '[Web] Create ER User', input: { scheme: 'BCT Pro' } }),
];

const flowRow = (rows: HistoryRow[]) => rows.find((r) => r.kind === 'flow') as Extract<HistoryRow, { kind: 'flow' }>;

describe('historyRows', () => {
  it('a flow run is one row and claims every run its steps made, earlier tries included', () => {
    const rows = historyRows(runs, [flow()]);
    expect(rows.map((r) => (r.kind === 'run' ? r.run.id : r.flow.id))).toEqual([LOOSE, flow().id]);
  });

  it('lists function steps by their flow number, leaving out IFs and skipped steps', () => {
    const steps = flowRow(historyRows(runs, [flow()])).steps;
    expect(steps.map((s) => [s.n, s.step.title])).toEqual([
      [1, '[Web] Create ER User'],
      [3, '[Admin] Vet'],
      [5, '[Web] Register'],
    ]);
  });

  it('a step carries its latest run; a step that never started, or whose run History lost, has none', () => {
    const steps = flowRow(historyRows(runs, [flow()])).steps;
    expect(steps[1].run?.id).toBe(C);
    expect(steps[2].run).toBeUndefined();
    const lost = flowRow(historyRows(runs.filter((r) => r.id !== A), [flow()])).steps;
    expect(lost[0].run).toBeUndefined();
  });

  it('sorts flows and loose runs together, newest first', () => {
    const later = flow({ id: '20261105-140000-gggg', startedAt: 9_000, steps: [] });
    expect(historyRows(runs, [flow(), later]).map((r) => (r.kind === 'run' ? r.run.id : r.flow.id))).toEqual([later.id, LOOSE, flow().id]);
  });

  it('without flow runs every run is its own row; with no runs, flows still show', () => {
    expect(historyRows(runs, []).every((r) => r.kind === 'run')).toBe(true);
    expect(historyRows(runs, [])).toHaveLength(4);
    expect(historyRows([], [flow()])).toHaveLength(1);
    expect(historyRows([], [])).toEqual([]);
  });

  it('a step with no tries field still works', () => {
    const plain = flow({ steps: [{ function: 'create-user', title: 'x', status: 'passed', runId: A }] });
    expect(historyRows(runs, [plain]).filter((r) => r.kind === 'run')).toHaveLength(3);
  });
});

describe('matchesRow', () => {
  const all = { status: 'all' as const, query: '' };
  const rows = historyRows(runs, [flow()]);
  const fRow = flowRow(rows);
  const loose = rows.find((r) => r.kind === 'run')!;

  it('a loose run goes by matchesHistory', () => {
    expect(matchesRow(loose, { ...all, status: 'passed' })).toBe(true);
    expect(matchesRow(loose, { ...all, query: 'enrol' })).toBe(true);
    expect(matchesRow(loose, { ...all, query: 'vet' })).toBe(false);
  });

  it('a flow goes by its own status, not its steps’', () => {
    expect(matchesRow(fRow, { ...all, status: 'failed' })).toBe(true);
    expect(matchesRow(fRow, { ...all, status: 'passed' })).toBe(false);
    expect(matchesRow({ ...fRow, flow: { ...fRow.flow, status: 'stopped' } }, { ...all, status: 'failed' })).toBe(true);
    expect(matchesRow({ ...fRow, flow: { ...fRow.flow, status: 'running' } }, { ...all, status: 'failed' })).toBe(false);
    expect(matchesRow({ ...fRow, flow: { ...fRow.flow, status: 'passed' } }, { ...all, status: 'passed' })).toBe(true);
  });

  it('the query matches the flow name, step titles and what the steps’ runs match', () => {
    expect(matchesRow(fRow, { ...all, query: ' new er ' })).toBe(true);
    expect(matchesRow(fRow, { ...all, query: 'register' })).toBe(true);
    expect(matchesRow(fRow, { ...all, query: 'bct pro' })).toBe(true);
    expect(matchesRow(fRow, { ...all, query: 'nothing' })).toBe(false);
  });
});

describe('matchesHistory', () => {
  it('still filters a single run by status and query', () => {
    expect(matchesHistory(run({ status: 'timedout' }), { status: 'failed', query: '' })).toBe(true);
    expect(matchesHistory(run({ status: 'stopping' }), { status: 'failed', query: '' })).toBe(false);
  });
});

describe('flowPlaceOf', () => {
  it('finds the step a run was the latest go of', () => {
    expect(flowPlaceOf(C, [flow()])).toMatchObject({ n: 3, title: '[Admin] Vet', latest: true });
  });
  it('finds an earlier try, marked not latest', () => {
    expect(flowPlaceOf(OLD_TRY, [flow()])).toMatchObject({ n: 3, latest: false });
  });
  it('is undefined for a run no flow made, or when there are no flows', () => {
    expect(flowPlaceOf(LOOSE, [flow()])).toBeUndefined();
    expect(flowPlaceOf(A, [])).toBeUndefined();
  });
});
