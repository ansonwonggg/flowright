import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it as test } from 'node:test';
import { expect } from './expect.ts';
import { emptyRun } from '../src/events.ts';
import { hasReport, listRuns, newRunId, readRun, RUN_ID, runDir, shownStatus, writeRun, type RunRecord } from '../src/history.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'runs-'));
const run = (id: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id,
  project: 'member-register',
  title: '[Web] Member Registration with Activation',
  startedAt: 1,
  status: 'passed',
  input: {},
  headed: false,
  view: emptyRun(),
  records: [],
  ...over,
});

describe('newRunId', () => {
  test('formats local date and time, then 4 base-36 chars', () =>
    expect(newRunId(new Date(2026, 10, 5, 9, 3, 7), () => 0.5)).toBe('20261105-090307-' + Math.floor(0.5 * 36 ** 4).toString(36)));
  test('pads a small random value to 4 chars', () => expect(newRunId(new Date(2026, 0, 1, 0, 0, 0), () => 0)).toBe('20260101-000000-0000'));
  test('largest random value still fits 4 chars', () => expect(newRunId(new Date(2026, 0, 1), () => 0.999999)).toMatch(RUN_ID));
  test('matches RUN_ID', () => expect(newRunId()).toMatch(RUN_ID));
});

describe('runDir', () => {
  test('accepts a run id', () => expect(runDir('20261105-090307-ab12', '/r')).toBe('/r/out/runs/20261105-090307-ab12'));
  for (const bad of ['../x', '20261105-090307-ab12/../../etc', '', 'abc'])
    test(`rejects ${JSON.stringify(bad)}`, () => expect(() => runDir(bad, '/r')).toThrow('not a run id'));
});

describe('writeRun / readRun', () => {
  test('round-trips run and log', () => {
    const root = tmp();
    writeRun(run('20261105-090307-ab12'), ['a', 'b'], root);
    expect(readRun('20261105-090307-ab12', root)).toEqual({ run: run('20261105-090307-ab12'), log: ['a', 'b'] });
  });
  test('without a log keeps the earlier log', () => {
    const root = tmp();
    writeRun(run('20261105-090307-ab12'), ['first'], root);
    writeRun(run('20261105-090307-ab12', { status: 'failed' }), undefined, root);
    expect(readRun('20261105-090307-ab12', root)).toMatchObject({ run: { status: 'failed' }, log: ['first'] });
  });
  test('no log file gives an empty log', () => {
    const root = tmp();
    writeRun(run('20261105-090307-ab12'), undefined, root);
    expect(readRun('20261105-090307-ab12', root)?.log).toEqual([]);
  });
  test('missing run, broken JSON and bad id give undefined', () => {
    const root = tmp();
    expect(readRun('20261105-090307-ab12', root)).toBeUndefined();
    mkdirSync(path.join(root, 'out/runs/20261105-090307-zz99'), { recursive: true });
    writeFileSync(path.join(root, 'out/runs/20261105-090307-zz99/run.json'), '{');
    expect(readRun('20261105-090307-zz99', root)).toBeUndefined();
    expect(readRun('../../etc', root)).toBeUndefined();
  });
});

describe('listRuns', () => {
  test('newest first, skipping other folders and broken runs, up to limit', () => {
    const root = tmp();
    writeRun(run('20261104-120000-aaaa'), [], root);
    writeRun(run('20261105-120000-bbbb'), [], root);
    writeRun(run('20261105-130000-cccc'), [], root);
    mkdirSync(path.join(root, 'out/runs/report'), { recursive: true });
    mkdirSync(path.join(root, 'out/runs/20261106-000000-dddd'), { recursive: true });
    expect(listRuns(root).map((r) => r.id)).toEqual(['20261105-130000-cccc', '20261105-120000-bbbb', '20261104-120000-aaaa']);
    expect(listRuns(root, 1).map((r) => r.id)).toEqual(['20261105-130000-cccc']);
  });
  test('no out/runs gives an empty list', () => expect(listRuns(tmp())).toEqual([]));
});

describe('hasReport', () => {
  test('true only with report/index.html', () => {
    const root = tmp();
    writeRun(run('20261105-090307-ab12'), [], root);
    expect(hasReport('20261105-090307-ab12', root)).toBe(false);
    mkdirSync(path.join(root, 'out/runs/20261105-090307-ab12/report'), { recursive: true });
    writeFileSync(path.join(root, 'out/runs/20261105-090307-ab12/report/index.html'), '');
    expect(hasReport('20261105-090307-ab12', root)).toBe(true);
  });
  test('false for a bad id', () => expect(hasReport('../x', tmp())).toBe(false));
});

describe('shownStatus', () => {
  test('a finished status is shown as is', () => expect(shownStatus({ id: 'a', status: 'failed' })).toBe('failed'));
  test('running and live stays running', () => expect(shownStatus({ id: 'a', status: 'running' }, 'a')).toBe('running'));
  test('running but not live is interrupted', () => expect(shownStatus({ id: 'a', status: 'running' }, 'b')).toBe('interrupted'));
  test('running with nothing live is interrupted', () => expect(shownStatus({ id: 'a', status: 'running' })).toBe('interrupted'));
});
