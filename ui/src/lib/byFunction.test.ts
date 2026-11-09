import { describe, expect, it } from 'vitest';
import { groupByFunction } from './byFunction.ts';
import { FUNCTIONS, record, run } from './fixtures.test-utils.ts';

const made = (ref: string, kind = 'er-user') => ({ kind, ref, stage: 'create-user', stageLabel: 'Create', summary: `${ref} Company AP @ PCCW` });
const userRun = (id: string, project: string, over = {}) => run({ id, project, title: project, records: [], input: { user_spec: '{"company":"PCCW"}' }, summary: 'Company AP for PCCW', ...over });

describe('groupByFunction', () => {
  it('one row per record a run made, joined to the record as it is now, in function order', () => {
    const groups = groupByFunction(FUNCTIONS, [userRun('r2', 'vet-datamod', { records: [made('DMD1')] }), userRun('r1', 'create-user', { records: [made('DMD1'), made('DMD2')] })], [record({ stage: 'vet-datamod' })], 'all', '');
    expect(groups.map((g) => g.fn.id)).toEqual(['create-user', 'vet-datamod']);
    expect(groups[0].rows.map((r) => [r.key, r.current?.stage])).toEqual([
      ['r1:DMD1', 'vet-datamod'],
      ['r1:DMD2', undefined],
    ]);
  });

  it('a record is matched by kind and key: the same key in another kind is another record', () =>
    expect(groupByFunction(FUNCTIONS, [userRun('r1', 'create-user', { records: [made('DMD1', 'member')] })], [record()], 'all', '')[0].rows[0].current).toBeUndefined());

  it('a run that saved nothing still gets a row, without made', () => {
    const [group] = groupByFunction(FUNCTIONS, [userRun('r1', 'create-user', { status: 'failed' })], [], 'all', '');
    expect(group.rows).toEqual([{ key: 'r1', run: expect.objectContaining({ id: 'r1' }) }]);
    expect(group.failed).toBe(1);
  });

  it('a run with no records list counts as none', () => expect(groupByFunction(FUNCTIONS, [userRun('r1', 'create-user', { records: undefined })], [], 'all', '')[0].rows).toHaveLength(1));

  it('leaves out running and stopping runs, unknown functions, and functions with no runs', () =>
    expect(groupByFunction(FUNCTIONS, [userRun('a', 'create-user', { status: 'running' }), userRun('b', 'create-user', { status: 'stopping' }), userRun('c', 'nope')], [], 'all', '')).toEqual([]));

  it('counts distinct runs as passed or failed', () => {
    const [group] = groupByFunction(
      FUNCTIONS,
      [userRun('a', 'create-user', { records: [made('D1'), made('D2')] }), userRun('b', 'create-user', { status: 'interrupted' }), userRun('c', 'create-user', { status: 'timedout' })],
      [],
      'all',
      '',
    );
    expect([group.passed, group.failed]).toEqual([1, 2]);
  });

  it('kind keeps the functions on that kind of record; all keeps those with none too', () => {
    const runs = [userRun('a', 'create-user'), userRun('b', 'member-register'), userRun('c', 'view-permissions')];
    expect(groupByFunction(FUNCTIONS, runs, [], 'member', '').map((g) => g.fn.id)).toEqual(['member-register']);
    expect(groupByFunction(FUNCTIONS, runs, [], 'er-user', '').map((g) => g.fn.id)).toEqual(['create-user']);
    expect(groupByFunction(FUNCTIONS, runs, [], 'all', '').map((g) => g.fn.id)).toEqual(['create-user', 'member-register', 'view-permissions']);
  });

  it('query matches title, summary, inputs, ref and the current details, ignoring case and spaces', () => {
    const runs = [userRun('a', 'create-user', { records: [made('DMD1')] })];
    const records = [record({ details: [['Username', 'etoe.found']] })];
    for (const q of ['  PCCW ', 'dmd1', 'ETOE.FOUND', 'company ap', 'create-user']) expect(groupByFunction(FUNCTIONS, runs, records, 'all', q), q).toHaveLength(1);
    expect(groupByFunction(FUNCTIONS, runs, records, 'all', 'nothing')).toEqual([]);
  });

  it('a run without inputs still matches by title', () => expect(groupByFunction(FUNCTIONS, [userRun('a', 'create-user', { input: undefined })], [], 'all', 'create')).toHaveLength(1));
});
