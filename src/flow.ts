import { valueProblem, type Fields } from './fields.ts';
import type { FunctionMeta } from './fn.ts';
import { cleanValues, type Values } from './values.ts';

/**
 * One step of a flow file: which function, and values typed for it. A JSON field's value may be written
 * inline as an object. A missing value comes from an earlier step, or from the record.
 */
export type FlowStep = { function: string; values?: Record<string, unknown> };

/**
 * A `*.flow.json` file: functions run one after another, each output passed on to later steps by name. `group` is the heading the app
 * lists the flow under; flows without one go under "Other", or show with no headings when none has one.
 */
export type FlowDef = { title?: string; group?: string; steps: FlowStep[] };

/** Where a flow step stands. `waiting` steps after a failed or stopped one never run. */
export type StepStatus = 'waiting' | 'running' | 'passed' | 'failed' | 'stopped';

/** A flow step while and after it runs. */
export type FlowRunStep = FlowStep & { title: string; status: StepStatus; input?: Values; output?: Values; error?: string; runId?: string };

/** One run of a flow. `values` holds every output so far; a later output of the same name wins. */
export type FlowRun = {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'passed' | 'failed' | 'stopped';
  steps: FlowRunStep[];
  values: Values;
};

const find = (fns: FunctionMeta[], id: string | undefined) => fns.find((f) => f.id === id);
const typed = (step: FlowStep): Values => cleanValues(step.values ?? {});

/** Which earlier step first gives each output name, for steps before `index`, 1-based. */
export const producedBefore = (fns: FunctionMeta[], steps: FlowStep[], index: number): Map<string, number> => {
  const produced = new Map<string, number>();
  steps.slice(0, index).forEach((step, i) => {
    for (const name of find(fns, step.function)?.outputs ?? []) if (!produced.has(name)) produced.set(name, i + 1);
  });
  return produced;
};

/**
 * Whether step `index` can get input `name` without typing it: an earlier step gives it, or the record
 * could hold it (the function has a record, its key is typed or given earlier, and some function on that
 * kind of record gives `name`).
 */
export const comesFromEarlier = (fns: FunctionMeta[], steps: FlowStep[], index: number): ((name: string) => boolean) => {
  const fn = find(fns, steps[index]?.function);
  const produced = producedBefore(fns, steps, index);
  const keyed = Boolean(fn?.recordKey && (typed(steps[index])[fn.recordKey] || produced.has(fn.recordKey)));
  return (name) => produced.has(name) || (keyed && fns.some((f) => f.record === fn?.record && f.outputs.includes(name)));
};

const stepProblems = (fns: FunctionMeta[], fields: Fields, steps: FlowStep[], index: number): string[] => {
  const step = steps[index];
  const where = `Step ${index + 1}`;
  const fn = find(fns, step?.function);
  if (!fn) return [`${where}: unknown function "${step?.function}"`];
  const problems: string[] = [];
  const values = typed(step);
  const given = comesFromEarlier(fns, steps, index);
  for (const [name, need] of Object.entries(fn.inputs))
    if (need === 'required' && !values[name] && !given(name)) problems.push(`${where}: ${fn.title} needs ${fields[name]?.label ?? name}`);
  for (const name of Object.keys(step.values ?? {})) {
    if (!(name in fn.inputs)) problems.push(`${where}: ${fn.title} has no input "${name}"`);
    else if (values[name]) {
      const problem = valueProblem(name, fields[name], values[name]);
      if (problem) problems.push(`${where}: ${problem}`);
    }
  }
  return problems;
};

/**
 * Everything wrong with a flow, one message per problem; empty when it can run.
 *
 * A required input counts as given when it is typed, given by an earlier step, or could come from the
 * record: the function has a record, its key is known, and some function on that kind of record gives
 * that name. Whether the saved record really holds it is only known when the step starts.
 */
export const flowProblems = (fns: FunctionMeta[], fields: Fields, flow: unknown): string[] => {
  const steps = (flow as FlowDef | undefined)?.steps;
  if (!Array.isArray(steps) || !steps.length) return ['A flow needs at least one step.'];
  return steps.flatMap((_, i) => stepProblems(fns, fields, steps, i));
};

/** Steps with a secret typed in, which a flow file (committed) must not hold. */
export const secretProblems = (fields: Fields, flow: FlowDef): string[] =>
  flow.steps.flatMap((step, i) =>
    Object.entries(typed(step))
      .filter(([name]) => fields[name]?.kind === 'secret')
      .map(([name]) => `Step ${i + 1}: don't save ${fields[name].label} in a flow file; leave it blank`),
  );

/** A step's inputs: each typed value, else the latest earlier output of the same name. Names with neither are left out. */
export const resolveInput = (fn: FunctionMeta, step: FlowStep, values: Values): Values => {
  const own = typed(step);
  return Object.fromEntries(
    Object.keys(fn.inputs).flatMap((name) => {
      const value = own[name] || values[name];
      return value ? [[name, value]] : [];
    }),
  );
};

/** A new run of `flow`, every step waiting. Assumes {@link flowProblems} found nothing. */
export const newFlowRun = (fns: FunctionMeta[], flow: FlowDef, opts: { id: string; name: string; now: number }): FlowRun => ({
  id: opts.id,
  name: opts.name,
  startedAt: opts.now,
  status: 'running',
  values: {},
  steps: flow.steps.map((s) => ({ ...s, title: find(fns, s.function)?.title ?? s.function, status: 'waiting' })),
});

/** Index of the step to run next, or -1 when the run is over or a step is running. */
export const nextStepIndex = (run: FlowRun): number =>
  run.status !== 'running' || run.steps.some((s) => s.status === 'running') ? -1 : run.steps.findIndex((s) => s.status === 'waiting');

/**
 * `run` with step `index` started on `input`. `runId` is the History run the step started as; a step that
 * never started one has none.
 */
export const stepStarted = (run: FlowRun, index: number, input: Values, runId?: string): FlowRun => ({
  ...run,
  steps: run.steps.map((s, i) => (i === index ? { ...s, status: 'running', input, ...(runId && { runId }) } : s)),
});

/**
 * `run` after its running step ended. A passed step adds its outputs to `values` and the run passes when
 * nothing is left waiting; a failed step fails the run and a stopped one stops it.
 */
export const stepEnded = (run: FlowRun, result: { status: 'passed' | 'failed' | 'stopped'; output?: Values; error?: string }, now: number): FlowRun => {
  const index = run.steps.findIndex((s) => s.status === 'running');
  if (index < 0) return run;
  const steps = run.steps.map((s, i) => (i === index ? { ...s, status: result.status, ...(result.output && { output: result.output }), ...(result.error && { error: result.error }) } : s));
  const values = result.status === 'passed' ? { ...run.values, ...result.output } : run.values;
  if (result.status !== 'passed') return { ...run, steps, values, status: result.status, endedAt: now };
  const done = !steps.some((s) => s.status === 'waiting');
  return { ...run, steps, values, ...(done && { status: 'passed', endedAt: now }) };
};
