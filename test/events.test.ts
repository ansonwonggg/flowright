import { describe, it as test } from 'node:test';
import { expect } from './expect.ts';
import { applyEvent, emptyRun, encodeEvent, parseLine, type FlowEvent, type RunView } from '../src/events.ts';

const run = (events: FlowEvent[]): RunView => events.reduce((view, e, i) => applyEvent(view, e, 1000 + i), emptyRun());

describe('parseLine', () => {
  test('round-trips an encoded event', () => {
    const e: FlowEvent = { type: 'step-begin', title: '1 REGISTER', depth: 0 };
    expect(parseLine(encodeEvent(e))).toEqual({ event: e });
  });
  test('plain text is log', () => expect(parseLine('hello')).toEqual({ log: 'hello' }));
  test('empty line is log', () => expect(parseLine('')).toEqual({ log: '' }));
  test('prefix with broken JSON stays log', () => expect(parseLine('@@flow {nope')).toEqual({ log: '@@flow {nope' }));
  test('prefix with JSON but no type stays log', () => expect(parseLine('@@flow {"a":1}')).toEqual({ log: '@@flow {"a":1}' }));
  test('prefix with null stays log', () => expect(parseLine('@@flow null')).toEqual({ log: '@@flow null' }));
});

describe('applyEvent', () => {
  test('starts empty and running', () => expect(emptyRun()).toEqual({ status: 'running', tests: [], failures: [] }));

  test('nests a depth-1 step under the open top-level step', () => {
    const view = run([
      { type: 'test-begin', title: 'flow' },
      { type: 'step-begin', title: '1 REGISTER', depth: 0 },
      { type: 'step-begin', title: 'fill', depth: 1 },
      { type: 'step-end', title: 'fill', depth: 1, ok: true, duration: 5 },
    ]);
    const top = view.tests[0].steps[0];
    expect(top).toMatchObject({ title: '1 REGISTER', status: 'running', startedAt: 1001 });
    expect(top.steps).toEqual([{ title: 'fill', status: 'passed', startedAt: 1002, duration: 5, steps: [] }]);
  });

  test('a failed step-end marks the step failed', () => {
    const view = run([
      { type: 'test-begin', title: 'flow' },
      { type: 'step-begin', title: '2 ACTIVATE', depth: 0 },
      { type: 'step-end', title: '2 ACTIVATE', depth: 0, ok: false, duration: 9 },
    ]);
    expect(view.tests[0].steps[0]).toMatchObject({ status: 'failed', duration: 9 });
  });

  test('steps with the same title end the latest running one', () => {
    const view = run([
      { type: 'test-begin', title: 't' },
      { type: 'step-begin', title: 'poll', depth: 0 },
      { type: 'step-end', title: 'poll', depth: 0, ok: true, duration: 1 },
      { type: 'step-begin', title: 'poll', depth: 0 },
      { type: 'step-end', title: 'poll', depth: 0, ok: false, duration: 2 },
    ]);
    expect(view.tests[0].steps.map((s) => s.status)).toEqual(['passed', 'failed']);
  });

  test('step events go to the latest test', () => {
    const view = run([
      { type: 'test-begin', title: 'login' },
      { type: 'test-end', title: 'login', status: 'passed', duration: 3 },
      { type: 'test-begin', title: 'flow' },
      { type: 'step-begin', title: '1', depth: 0 },
    ]);
    expect(view.tests[0]).toMatchObject({ status: 'passed', duration: 3, steps: [] });
    expect(view.tests[1].steps).toHaveLength(1);
  });

  test('step before any test is ignored', () => expect(run([{ type: 'step-begin', title: 'x', depth: 0 }]).tests).toEqual([]));
  test('depth-1 step with no top-level step is ignored', () =>
    expect(run([{ type: 'test-begin', title: 't' }, { type: 'step-begin', title: 'x', depth: 1 }]).tests[0].steps).toEqual([]));
  test('step-end with no matching running step changes nothing', () => {
    const before = run([{ type: 'test-begin', title: 't' }, { type: 'step-begin', title: 'a', depth: 0 }]);
    expect(applyEvent(before, { type: 'step-end', title: 'b', depth: 0, ok: true, duration: 1 }, 0)).toEqual(before);
  });

  test('failure is collected', () => {
    const failure: FlowEvent = { type: 'failure', test: 't', kind: 'portal', title: 'DEV returned an error', hint: 'h', error: 'e' };
    expect(run([failure]).failures).toEqual([failure]);
  });
  test('end passed', () => expect(run([{ type: 'end', status: 'passed' }]).status).toBe('passed'));
  for (const status of ['failed', 'timedout', 'interrupted'])
    test(`end ${status} is failed`, () => expect(run([{ type: 'end', status }]).status).toBe('failed'));
  test('unknown event type changes nothing', () => expect(applyEvent(emptyRun(), { type: 'nope' } as never, 0)).toEqual(emptyRun()));
  test('does not mutate the input view', () => {
    const before = run([{ type: 'test-begin', title: 't' }]);
    const snapshot = JSON.stringify(before);
    applyEvent(before, { type: 'step-begin', title: 'a', depth: 0 }, 0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
