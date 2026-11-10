import { isIf, type Arm, type FlowRun, type FlowRunStep } from '../../../src/flow.ts';

/** A piece of the run canvas, left to right: one step, or an IF with the flat indexes of each arm's steps. */
export type Segment = { kind: 'step'; index: number } | { kind: 'fork'; index: number; then: number[]; else: number[] };

/** How a wire between two points of the canvas is drawn. */
export type WireState = 'idle' | 'lit' | 'flow' | 'dead';

/** A flat flow (run steps, as laid out by `flatten`) as canvas segments. Arm steps sit in their IF's fork. */
export const segmentsOf = (steps: FlowRun['steps']): Segment[] =>
  steps.flatMap((step, index): Segment[] => {
    if (isIf(step)) {
      const arm = (which: Arm) => steps.flatMap((s, i) => (!isIf(s) && s.branch?.at === index && s.branch.arm === which ? [i] : []));
      return [{ kind: 'fork', index, then: arm('then'), else: arm('else') }];
    }
    return step.branch ? [] : [{ kind: 'step', index }];
  });

const reached = (step: FlowRunStep | undefined) => step?.status === 'passed';

/**
 * The wire into `to` (a step, or `undefined` for a join or the end) from a point that is `lit` when the
 * flow has got there. It flows into a running step, is dead into a skipped one, and lights once the
 * flow got to where it starts.
 */
export const wireInto = (fromLit: boolean, to: FlowRunStep | undefined): WireState => {
  if (to?.status === 'skipped') return 'dead';
  if (to?.status === 'running') return 'flow';
  return fromLit ? 'lit' : 'idle';
};

/** Whether the flow got through a fork: its IF is decided and every step in the arm it took passed. */
export const forkDone = (steps: FlowRun['steps'], fork: Extract<Segment, { kind: 'fork' }>): boolean => {
  const ifStep = steps[fork.index];
  if (!ifStep?.taken) return false;
  return fork[ifStep.taken].every((i) => reached(steps[i]));
};

/** Whether the flow got through segment `seg`: its step passed, or its fork is done. */
export const segmentDone = (steps: FlowRun['steps'], seg: Segment): boolean => (seg.kind === 'step' ? reached(steps[seg.index]) : forkDone(steps, seg));

/**
 * The step a run page shows by default: the running one, else the first that failed or stopped, else
 * the last that ran (an IF counts), else the first.
 */
export const autoSelected = (run: FlowRun): number => {
  const running = run.steps.findIndex((s) => s.status === 'running');
  if (running >= 0) return running;
  const ended = run.steps.findIndex((s) => s.status === 'failed' || s.status === 'stopped');
  if (ended >= 0) return ended;
  const passed = run.steps.map((s) => s.status).lastIndexOf('passed');
  return Math.max(passed, 0);
};

/** The short line under a step's name on the canvas, e.g. `3 values`, `running…`, `took true`. */
export const nodeNote = (step: FlowRunStep): string => {
  if (isIf(step)) return step.taken ? `took ${step.taken === 'then' ? 'true' : 'false'}` : step.status;
  if (step.status === 'passed') {
    const n = Object.keys(step.output ?? {}).length;
    return n ? `${n} value${n === 1 ? '' : 's'} out` : 'passed';
  }
  return step.status === 'running' ? 'running…' : step.status;
};
