import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it as test } from 'node:test';
import { expect } from './expect.ts';
import type { FlowRun } from '../src/flow.ts';
import { FLOW_RUNS_DIR, listFlowRuns, readFlowRun, readOutput, writeFlowRun } from '../src/flowRuns.ts';

const root = () => mkdtempSync(path.join(tmpdir(), 'flow-runs-'));
const run = (id: string, startedAt: number): FlowRun => ({ id, name: 'n', startedAt, status: 'passed', steps: [], values: {} });

describe('flow runs on disk', () => {
  test('write then read', () => {
    const dir = root();
    writeFlowRun(run('20261105-120000-aaaa', 1), dir);
    expect(readFlowRun('20261105-120000-aaaa', dir)).toEqual(run('20261105-120000-aaaa', 1));
  });
  test('a malformed id is refused on write and unknown on read', () => {
    expect(() => writeFlowRun(run('../x', 1), root())).toThrow('not a flow run id');
    expect(readFlowRun('../x', root())).toBeUndefined();
  });
  test('missing or broken files read as undefined', () => {
    const dir = root();
    expect(readFlowRun('20261105-120000-aaaa', dir)).toBeUndefined();
    mkdirSync(path.join(dir, FLOW_RUNS_DIR), { recursive: true });
    writeFileSync(path.join(dir, FLOW_RUNS_DIR, '20261105-120000-aaaa.json'), '{bad');
    expect(readFlowRun('20261105-120000-aaaa', dir)).toBeUndefined();
  });
  test('list: newest first, limited, skipping what isn\'t a flow run', () => {
    const dir = root();
    writeFlowRun(run('20261105-120000-aaaa', 1), dir);
    writeFlowRun(run('20261105-120001-bbbb', 3), dir);
    writeFlowRun(run('20261105-120002-cccc', 2), dir);
    writeFileSync(path.join(dir, FLOW_RUNS_DIR, '20261105-120003-dddd.json'), '{"no":"steps"}');
    writeFileSync(path.join(dir, FLOW_RUNS_DIR, 'notes.txt'), 'x');
    expect(listFlowRuns(dir).map((r) => r.startedAt)).toEqual([3, 2, 1]);
    expect(listFlowRuns(dir, 1)).toHaveLength(1);
  });
  test('no folder: nothing', () => expect(listFlowRuns(root())).toEqual([]));
});

describe('readOutput', () => {
  const file = (body: string) => {
    const f = path.join(root(), 'output.json');
    writeFileSync(f, body);
    return f;
  };
  test('non-empty strings', () => expect(readOutput(file('{"a":"x","b":"","c":1}'))).toEqual({ a: 'x' }));
  test('missing file', () => expect(readOutput(path.join(root(), 'none.json'))).toBeUndefined());
  for (const body of ['{bad', '[]', 'null']) test(`not an object: ${body}`, () => expect(readOutput(file(body))).toBeUndefined());
});
