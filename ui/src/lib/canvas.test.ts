import { describe, expect, it } from 'vitest';
import type { FlowRun, FlowRunStep } from '../api.ts';
import { autoSelected, forkDone, nodeNote, segmentDone, segmentsOf, wireInto } from './canvas.ts';

const fn = (id: string, status: FlowRunStep['status'], over: Partial<FlowRunStep> = {}): FlowRunStep => ({ function: id, title: id, status, ...over }) as FlowRunStep;
const ifStep = (status: FlowRunStep['status'], over: Partial<FlowRunStep> = {}): FlowRunStep => ({ if: { value: 'status', equals: 'X' }, title: 'If status is X', status, ...over }) as FlowRunStep;
const run = (steps: FlowRunStep[], over: Partial<FlowRun> = {}): FlowRun => ({ id: 'r', name: 'n', startedAt: 0, status: 'running', values: {}, steps, ...over });

const BRANCHY = [
  fn('enrol', 'passed'),
  ifStep('passed', { taken: 'then' }),
  fn('vet', 'running', { branch: { at: 1, arm: 'then' } }),
  fn('vet2', 'waiting', { branch: { at: 1, arm: 'then' } }),
  fn('note', 'skipped', { branch: { at: 1, arm: 'else' } }),
  fn('after', 'waiting'),
];

describe('segmentsOf', () => {
  it('top-level steps, and an IF as a fork holding its arms', () =>
    expect(segmentsOf(BRANCHY)).toEqual([
      { kind: 'step', index: 0 },
      { kind: 'fork', index: 1, then: [2, 3], else: [4] },
      { kind: 'step', index: 5 },
    ]));
  it('a linear run is one step per segment', () => expect(segmentsOf([fn('a', 'waiting'), fn('b', 'waiting')])).toEqual([{ kind: 'step', index: 0 }, { kind: 'step', index: 1 }]));
  it('an IF with an empty arm', () => expect(segmentsOf([ifStep('waiting'), fn('a', 'waiting', { branch: { at: 0, arm: 'else' } })])).toEqual([{ kind: 'fork', index: 0, then: [], else: [1] }]));
  it('no steps', () => expect(segmentsOf([])).toEqual([]));
});

describe('wireInto', () => {
  it('dead into a skipped step, whatever came before', () => {
    expect(wireInto(true, fn('a', 'skipped'))).toBe('dead');
    expect(wireInto(false, fn('a', 'skipped'))).toBe('dead');
  });
  it('flows into a running step', () => expect(wireInto(true, fn('a', 'running'))).toBe('flow'));
  it('lit once the flow got to its start; idle before', () => {
    expect(wireInto(true, fn('a', 'waiting'))).toBe('lit');
    expect(wireInto(true, fn('a', 'passed'))).toBe('lit');
    expect(wireInto(false, fn('a', 'waiting'))).toBe('idle');
    expect(wireInto(true, undefined)).toBe('lit');
    expect(wireInto(false, undefined)).toBe('idle');
  });
});

describe('forkDone and segmentDone', () => {
  const fork = { kind: 'fork' as const, index: 1, then: [2, 3], else: [4] };
  it('not done while the taken arm has steps left', () => expect(forkDone(BRANCHY, fork)).toBe(false));
  it('done once every taken-arm step passed; the skipped arm does not count', () => {
    const steps = BRANCHY.map((s, i) => (i === 2 || i === 3 ? { ...s, status: 'passed' as const } : s));
    expect(forkDone(steps, fork)).toBe(true);
    expect(segmentDone(steps, fork)).toBe(true);
  });
  it('an undecided IF is not done; a taken empty arm is', () => {
    expect(forkDone([fn('a', 'passed'), ifStep('waiting')], { kind: 'fork', index: 1, then: [], else: [] })).toBe(false);
    expect(forkDone([fn('a', 'passed'), ifStep('passed', { taken: 'else' }), fn('v', 'skipped')], { kind: 'fork', index: 1, then: [2], else: [] })).toBe(true);
  });
  it('a step segment is done when it passed', () => {
    expect(segmentDone(BRANCHY, { kind: 'step', index: 0 })).toBe(true);
    expect(segmentDone(BRANCHY, { kind: 'step', index: 5 })).toBe(false);
  });
});

describe('autoSelected', () => {
  it('the running step', () => expect(autoSelected(run(BRANCHY))).toBe(2));
  it('else the first failed or stopped one', () => {
    expect(autoSelected(run([fn('a', 'passed'), fn('b', 'failed'), fn('c', 'waiting')], { status: 'failed' }))).toBe(1);
    expect(autoSelected(run([fn('a', 'stopped'), fn('b', 'waiting')], { status: 'stopped' }))).toBe(0);
  });
  it('else the last that ran, an IF included', () => {
    expect(autoSelected(run([fn('a', 'passed'), ifStep('passed', { taken: 'else' }), fn('v', 'skipped', { branch: { at: 1, arm: 'then' } })], { status: 'passed' }))).toBe(1);
    expect(autoSelected(run([fn('a', 'passed'), fn('b', 'passed')], { status: 'passed' }))).toBe(1);
  });
  it('else the first', () => expect(autoSelected(run([fn('a', 'waiting')]))).toBe(0));
});

describe('nodeNote', () => {
  it('a passed step counts its outputs', () => {
    expect(nodeNote(fn('a', 'passed', { output: { a: '1', b: '2' } }))).toBe('2 values out');
    expect(nodeNote(fn('a', 'passed', { output: { a: '1' } }))).toBe('1 value out');
    expect(nodeNote(fn('a', 'passed'))).toBe('passed');
  });
  it('other statuses by name; running with an ellipsis', () => {
    expect(nodeNote(fn('a', 'running'))).toBe('running…');
    for (const status of ['waiting', 'failed', 'stopped', 'skipped'] as const) expect(nodeNote(fn('a', status))).toBe(status);
  });
  it('an IF says which way it went, or its status', () => {
    expect(nodeNote(ifStep('passed', { taken: 'then' }))).toBe('took true');
    expect(nodeNote(ifStep('passed', { taken: 'else' }))).toBe('took false');
    expect(nodeNote(ifStep('waiting'))).toBe('waiting');
  });
});
