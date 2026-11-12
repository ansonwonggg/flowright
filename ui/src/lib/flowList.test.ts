import { describe, expect, it } from 'vitest';
import type { FlowRun, Preset } from '../api.ts';
import { DEFAULT_SORT, filterRows, flowRows, nextSort, parseSort, sortRows, type FlowRow, type Sort } from './flowList.ts';

const flow = (file: string, over: Partial<Preset> & { group?: string; fns?: string[] } = {}): Preset => {
  const { group, fns = ['a'], ...rest } = over;
  return {
    file: `config/flows/${file}.flow.json`,
    label: file,
    summary: fns.join(' → '),
    spec: { ...(group !== undefined && { group }), steps: fns.map((f) => ({ function: f })) },
    ...rest,
  };
};

const run = (id: string, startedAt: number, over: Partial<FlowRun> = {}): FlowRun => ({ id, name: id, startedAt, status: 'passed', steps: [], values: {}, ...over });

const row = (label: string, over: Partial<FlowRow> = {}): FlowRow => ({
  file: `config/flows/${label}.flow.json`,
  label,
  group: '',
  steps: '',
  stepCount: 1,
  ...over,
});

const labels = (rows: FlowRow[]) => rows.map((r) => r.label);

describe('flowRows', () => {
  it('copies label, file, summary and modified time; reads the group from the spec', () => {
    const [r] = flowRows([flow('x', { group: ' Web ', fns: ['a', 'b'], modifiedAt: 5 })], []);
    expect(r).toEqual({ file: 'config/flows/x.flow.json', label: 'x', group: 'Web', steps: 'a → b', stepCount: 2, modifiedAt: 5 });
  });

  it('counts function steps, both arms of an IF included, but not the IF itself', () => {
    const spec = { steps: [{ function: 'a' }, { if: { value: 'v' }, then: [{ function: 'b' }, { function: 'c' }], else: [{ function: 'd' }] }] };
    expect(flowRows([{ ...flow('x'), spec }], [])[0].stepCount).toBe(4);
  });

  it('a spec that is not a flow (bad JSON) gives no group and no steps', () => {
    expect(flowRows([{ ...flow('x'), spec: undefined, summary: '' }], [])[0]).toMatchObject({ group: '', stepCount: 0 });
  });

  it('last run: the newest run started from that file', () => {
    const runs = [run('old', 1, { file: 'config/flows/x.flow.json' }), run('new', 3, { file: 'config/flows/x.flow.json' }), run('other', 9, { file: 'config/flows/y.flow.json' })];
    expect(flowRows([flow('x')], runs)[0].lastRun?.id).toBe('new');
  });

  it('runs with no file are never matched, even by name', () => {
    expect(flowRows([flow('x')], [run('x', 1, { name: 'x' })])[0].lastRun).toBeUndefined();
  });

  it('no flows: no rows', () => expect(flowRows([], [run('r', 1, { file: 'config/flows/x.flow.json' })])).toEqual([]));
});

describe('filterRows', () => {
  const rows = [row('New ER user', { group: 'Employer', steps: 'Create → Vet', file: 'config/flows/new-er-user.flow.json' }), row('Enrol SEP', { group: 'Member', steps: 'Register → Enrol' })];

  it('blank or spaces only: every row, in order', () => {
    expect(labels(filterRows(rows, ''))).toEqual(['New ER user', 'Enrol SEP']);
    expect(labels(filterRows(rows, '   '))).toEqual(['New ER user', 'Enrol SEP']);
  });
  it('matches the name, ignoring case', () => expect(labels(filterRows(rows, 'er USER'))).toEqual(['New ER user']));
  it('matches a step name', () => expect(labels(filterRows(rows, 'vet'))).toEqual(['New ER user']));
  it('matches the group', () => expect(labels(filterRows(rows, 'member'))).toEqual(['Enrol SEP']));
  it('matches the file name', () => expect(labels(filterRows(rows, 'new-er'))).toEqual(['New ER user']));
  it('every word must match, in any field and any order', () => {
    expect(labels(filterRows(rows, 'enrol member'))).toEqual(['Enrol SEP']);
    expect(labels(filterRows(rows, 'enrol employer'))).toEqual([]);
  });
  it('nothing matches: no rows', () => expect(filterRows(rows, 'zzz')).toEqual([]));
});

describe('sortRows', () => {
  const sorted = (rows: FlowRow[], sort: Sort) => labels(sortRows(rows, sort));

  it('does not change the rows it is given', () => {
    const rows = [row('b'), row('a')];
    sortRows(rows, { key: 'name', dir: 'asc' });
    expect(labels(rows)).toEqual(['b', 'a']);
  });

  it('name: ignores case and orders numbers by value', () => {
    const rows = [row('flow 10'), row('Flow 2'), row('alpha')];
    expect(sorted(rows, { key: 'name', dir: 'asc' })).toEqual(['alpha', 'Flow 2', 'flow 10']);
    expect(sorted(rows, { key: 'name', dir: 'desc' })).toEqual(['flow 10', 'Flow 2', 'alpha']);
  });

  it('group: no group goes last both ways; ties by name ascending', () => {
    const rows = [row('z', { group: 'Web' }), row('none'), row('a', { group: 'Web' }), row('m', { group: 'Admin' })];
    expect(sorted(rows, { key: 'group', dir: 'asc' })).toEqual(['m', 'a', 'z', 'none']);
    expect(sorted(rows, { key: 'group', dir: 'desc' })).toEqual(['a', 'z', 'm', 'none']);
  });

  it('steps: by count; ties by name', () => {
    const rows = [row('b', { stepCount: 3 }), row('a', { stepCount: 3 }), row('c', { stepCount: 1 }), row('d', { stepCount: 0 })];
    expect(sorted(rows, { key: 'steps', dir: 'asc' })).toEqual(['d', 'c', 'a', 'b']);
    expect(sorted(rows, { key: 'steps', dir: 'desc' })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('last run: by start time; never run goes last both ways', () => {
    const rows = [row('never'), row('old', { lastRun: run('1', 1) }), row('new', { lastRun: run('2', 2) })];
    expect(sorted(rows, { key: 'lastRun', dir: 'desc' })).toEqual(['new', 'old', 'never']);
    expect(sorted(rows, { key: 'lastRun', dir: 'asc' })).toEqual(['old', 'new', 'never']);
  });

  it('modified: by time; unknown goes last both ways; same time by name', () => {
    const rows = [row('unknown'), row('b', { modifiedAt: 5 }), row('a', { modifiedAt: 5 }), row('old', { modifiedAt: 0 })];
    expect(sorted(rows, { key: 'modified', dir: 'desc' })).toEqual(['a', 'b', 'old', 'unknown']);
    expect(sorted(rows, { key: 'modified', dir: 'asc' })).toEqual(['old', 'a', 'b', 'unknown']);
  });

  it('several rows missing the value keep name order among themselves', () =>
    expect(sorted([row('b'), row('a'), row('x', { modifiedAt: 1 })], { key: 'modified', dir: 'asc' })).toEqual(['x', 'a', 'b']));

  it('one row and no rows', () => {
    expect(sorted([row('a')], { key: 'group', dir: 'desc' })).toEqual(['a']);
    expect(sortRows([], DEFAULT_SORT)).toEqual([]);
  });
});

describe('nextSort', () => {
  it('the same column flips the direction', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });
  it('a text or count column starts ascending', () => {
    for (const key of ['name', 'group', 'steps'] as const) expect(nextSort({ key: 'modified', dir: 'desc' }, key)).toEqual({ key, dir: 'asc' });
  });
  it('a time column starts newest first', () => {
    for (const key of ['lastRun', 'modified'] as const) expect(nextSort({ key: 'name', dir: 'asc' }, key)).toEqual({ key, dir: 'desc' });
  });
});

describe('parseSort', () => {
  it('reads what was saved', () => expect(parseSort(JSON.stringify({ key: 'lastRun', dir: 'asc' }))).toEqual({ key: 'lastRun', dir: 'asc' }));
  for (const bad of [null, '', 'not json', '[]', 'null', '{"key":"size","dir":"asc"}', '{"key":"name","dir":"up"}', '{"key":"name"}'])
    it(`falls back to name ascending for ${JSON.stringify(bad)}`, () => expect(parseSort(bad)).toEqual(DEFAULT_SORT));
  it('the default is name ascending', () => expect(DEFAULT_SORT).toEqual({ key: 'name', dir: 'asc' }));
});
