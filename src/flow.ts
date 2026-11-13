import { valueProblem, type Fields } from './fields.ts';
import type { FunctionMeta } from './fn.ts';
import { cleanValues, type Values } from './values.ts';

/**
 * One function step of a flow file: which function, and values typed for it. A JSON field's value may be
 * written inline as an object. A missing value comes from an earlier step, or from the record.
 */
export type FnStep = { function: string; values?: Record<string, unknown> };

/**
 * What an IF tests: the latest value of `value` passed along so far. `equals` holds when the value is that
 * text, `notEquals` when it isn't; with neither, it holds when the value is set. Text is compared trimmed
 * and case-sensitive; a value no step gave counts as empty.
 */
export type Condition = { value: string; equals?: string; notEquals?: string };

/** A branch of a flow: `then` runs when `if` holds, `else` otherwise. Arms hold function steps only, not another IF. */
export type IfStep = { if: Condition; then: FnStep[]; else?: FnStep[] };

/** One step of a flow file: a function, or an IF with two arms. */
export type FlowStep = FnStep | IfStep;

/**
 * A `*.flow.json` file: steps run one after another, each output passed on to later steps by name. `group` is the heading the app
 * lists the flow under; flows without one go under "Other", or show with no headings when none has one.
 */
export type FlowDef = { title?: string; group?: string; steps: FlowStep[] };

/** Which arm of an IF a step is in. */
export type Arm = 'then' | 'else';

/** The IF a step sits under: `at` is the IF's index in the flat list. */
export type Branch = { at: number; arm: Arm };

/** An IF as laid out flat: its arms follow it, each step tagged with a {@link Branch}. */
export type FlatIf = { if: Condition; branch?: Branch };

/** A function step as laid out flat; `branch` is set when it sits in an IF's arm. */
export type FlatFn = FnStep & { branch?: Branch };

/**
 * A flow laid out as one list, the way it is numbered ("Step 3") and run: each IF is followed by its
 * then-arm, then its else-arm.
 */
export type FlatStep = FlatFn | FlatIf;

/**
 * Where a flow step stands. `waiting` steps after a failed or stopped one never run; `skipped` steps sit
 * in the arm an IF didn't take.
 */
export type StepStatus = 'waiting' | 'running' | 'passed' | 'failed' | 'stopped' | 'skipped';

/**
 * An earlier go at a step that failed or was stopped, kept on the step when the run is retried (see
 * {@link retriedFlowRun}). `runId` is its run in History, absent when it could not start; `output` is what it
 * gave out before failing, never passed along.
 */
export type StepTry = { status: 'failed' | 'stopped'; error?: string; runId?: string; output?: Values };

/**
 * A flow step while and after it runs. A decided IF has `status: 'passed'`, the arm it `taken`, and as
 * `input` the value it tested (`''` when no step gave it). `tries` holds its earlier failed or stopped
 * goes, oldest first, when the run was retried; the step's own fields describe the latest go.
 */
export type FlowRunStep = FlatStep & { title: string; status: StepStatus; input?: Values; output?: Values; error?: string; runId?: string; taken?: Arm; tries?: StepTry[] };

/**
 * One run of a flow. `values` holds every output so far; a later output of the same name wins. `file` is the
 * saved flow it was started from, from the repo root (`config/flows/x.flow.json`); absent for a flow that was
 * never saved, and for runs made before flowright 0.1.7. `env` is the environment it ran in (see
 * `FLOWKIT_ENV`); absent when it ran on `.env.local` alone.
 */
export type FlowRun = {
  id: string;
  name: string;
  file?: string;
  env?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'passed' | 'failed' | 'stopped';
  steps: FlowRunStep[];
  values: Values;
};

/** Whether a step (of a flow file, or laid out flat) is an IF. */
export const isIf = (step: unknown): step is FlatIf => Boolean(step && typeof step === 'object' && 'if' in step);

const asList = (list: unknown): unknown[] => (Array.isArray(list) ? list : []);

/**
 * `flow`'s steps laid out flat (see {@link FlatStep}). Anything that isn't a flow gives `[]`; a step that
 * isn't an object becomes `{}`, which {@link flowProblems} reports as an unknown function.
 */
export const flatten = (flow: unknown): FlatStep[] => {
  const flat: FlatStep[] = [];
  const object = (s: unknown) => (s && typeof s === 'object' ? s : {}) as FlatStep;
  for (const step of asList((flow as FlowDef | null | undefined)?.steps)) {
    if (!isIf(step)) {
      flat.push(object(step));
      continue;
    }
    const at = flat.length;
    flat.push({ if: step.if });
    for (const arm of ['then', 'else'] as const) for (const s of asList((step as IfStep)[arm])) flat.push({ ...object(s), branch: { at, arm } });
  }
  return flat;
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

/** Whether `condition` holds on `values`; see {@link Condition}. */
export const conditionHolds = (condition: Condition, values: Values): boolean => {
  const value = text(values[condition.value]);
  if (condition.equals !== undefined) return value === text(condition.equals);
  if (condition.notEquals !== undefined) return value !== text(condition.notEquals);
  return value !== '';
};

/** A condition in words, e.g. `status is NEEDS_DDE`, `status is not PENDING`, `status is set`, `status is empty`. */
export const conditionText = (condition: Condition): string => {
  const name = text(condition?.value) || '?';
  if (condition?.equals !== undefined) return text(condition.equals) ? `${name} is ${text(condition.equals)}` : `${name} is empty`;
  if (condition?.notEquals !== undefined) return `${name} is not ${text(condition.notEquals)}`;
  return `${name} is set`;
};

const find = (fns: FunctionMeta[], id: string | undefined) => fns.find((f) => f.id === id);
const typed = (step: FlatStep | undefined): Values => (step && !isIf(step) ? cleanValues(step.values ?? {}) : {});

const armOutputs = (fns: FunctionMeta[], steps: FlatStep[], at: number, arm: Arm): Set<string> =>
  new Set(steps.flatMap((s) => (!isIf(s) && s.branch?.at === at && s.branch.arm === arm ? (find(fns, s.function)?.outputs ?? []) : [])));

/**
 * Which earlier step first gives each output name, for step `index` of the flat list, numbered 1-based.
 *
 * A step in an IF's arm sees what came before the IF and earlier in its own arm, never the other arm. A
 * step after the IF sees an arm's output only when both arms give that name; it is then credited to the
 * first arm step that gives it.
 */
export const producedBefore = (fns: FunctionMeta[], steps: FlatStep[], index: number): Map<string, number> => {
  const target = steps[index];
  const here = target && !isIf(target) ? target.branch : undefined;
  const both = new Map<number, Set<string>>();
  const inBoth = (at: number, name: string) => {
    if (!both.has(at)) {
      const then = armOutputs(fns, steps, at, 'then');
      const other = armOutputs(fns, steps, at, 'else');
      both.set(at, new Set([...then].filter((n) => other.has(n))));
    }
    return both.get(at)!.has(name);
  };
  const produced = new Map<string, number>();
  steps.slice(0, index).forEach((step, i) => {
    if (isIf(step)) return;
    const b = step.branch;
    for (const name of find(fns, step.function)?.outputs ?? []) {
      if (produced.has(name)) continue;
      const onPath = !b || (here?.at === b.at && here.arm === b.arm);
      if (onPath || (here?.at !== b.at && inBoth(b.at, name))) produced.set(name, i + 1);
    }
  });
  return produced;
};

/**
 * Whether step `index` of the flat list can get input `name` without typing it: an earlier step gives it
 * (see {@link producedBefore}), or the record could hold it (the function has a record, its key is typed
 * or given earlier, and some function on that kind of record gives `name`).
 */
export const comesFromEarlier = (fns: FunctionMeta[], steps: FlatStep[], index: number): ((name: string) => boolean) => {
  const step = steps[index];
  const fn = step && !isIf(step) ? find(fns, step.function) : undefined;
  const produced = producedBefore(fns, steps, index);
  const keyed = Boolean(fn?.recordKey && (typed(step)[fn.recordKey] || produced.has(fn.recordKey)));
  return (name) => produced.has(name) || (keyed && fns.some((f) => f.record === fn?.record && f.outputs.includes(name)));
};

const ifProblems = (fns: FunctionMeta[], fields: Fields, steps: FlatStep[], index: number): string[] => {
  const step = steps[index] as FlatIf;
  const where = `Step ${index + 1}`;
  if (step.branch) return [`${where}: an IF can't hold another IF`];
  const cond = (step.if && typeof step.if === 'object' ? step.if : {}) as Partial<Condition>;
  const name = text(cond.value);
  const problems: string[] = [];
  if (!name) problems.push(`${where}: the IF needs a value to test`);
  else if (!producedBefore(fns, steps, index).has(name)) problems.push(`${where}: the IF needs ${fields[name]?.label ?? name} from an earlier step`);
  if (cond.equals !== undefined && cond.notEquals !== undefined) problems.push(`${where}: the IF takes equals or notEquals, not both`);
  if (!steps.some((s) => s.branch?.at === index)) problems.push(`${where}: the IF has no steps in either branch`);
  return problems;
};

const stepProblems = (fns: FunctionMeta[], fields: Fields, steps: FlatStep[], index: number): string[] => {
  if (isIf(steps[index])) return ifProblems(fns, fields, steps, index);
  const step = steps[index] as FlatFn;
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
 * Everything wrong with a flow, one message per problem, numbered as the flow is laid out flat; empty
 * when it can run.
 *
 * A required input counts as given when it is typed, given by an earlier step (see
 * {@link producedBefore} for what an IF's arms give), or could come from the record: the function has a
 * record, its key is known, and some function on that kind of record gives that name. Whether the saved
 * record really holds it is only known when the step starts. An IF needs a value an earlier step gives,
 * at most one of `equals` / `notEquals`, and a step in at least one arm; an arm can't hold another IF.
 */
export const flowProblems = (fns: FunctionMeta[], fields: Fields, flow: unknown): string[] => {
  const steps = flatten(flow);
  if (!steps.length) return ['A flow needs at least one step.'];
  return steps.flatMap((_, i) => stepProblems(fns, fields, steps, i));
};

/** Steps with a secret typed in, which a flow file (committed) must not hold. */
export const secretProblems = (fields: Fields, flow: FlowDef): string[] =>
  flatten(flow).flatMap((step, i) =>
    Object.entries(typed(step))
      .filter(([name]) => fields[name]?.kind === 'secret')
      .map(([name]) => `Step ${i + 1}: don't save ${fields[name].label} in a flow file; leave it blank`),
  );

/** A step's inputs: each typed value, else the latest earlier output of the same name. Names with neither are left out. */
export const resolveInput = (fn: FunctionMeta, step: FnStep, values: Values): Values => {
  const own = cleanValues(step.values ?? {});
  return Object.fromEntries(
    Object.keys(fn.inputs).flatMap((name) => {
      const value = own[name] || values[name];
      return value ? [[name, value]] : [];
    }),
  );
};

/** A step's title: its function's title (its id when unknown), or `If <condition>` for an IF. */
export const stepTitle = (fns: Pick<FunctionMeta, 'id' | 'title'>[], step: FlatStep): string =>
  isIf(step) ? `If ${conditionText(step.if)}` : (fns.find((f) => f.id === step.function)?.title ?? String(step.function));

/** Every function id a flow uses, arms included, in flat order; repeats kept. */
export const functionsIn = (flow: unknown): string[] => flatten(flow).flatMap((s) => (isIf(s) ? [] : [String(s.function)]));

/**
 * A flow in one line, e.g. `Enrol → If status is NEEDS_DDE: Vet | else: Note → After`. An arm with no
 * steps reads `—`; an IF with no else leaves that part out.
 */
export const flowSummary = (fns: Pick<FunctionMeta, 'id' | 'title'>[], flow: unknown): string => {
  const flat = flatten(flow);
  const arm = (at: number, which: Arm) => flat.filter((s) => !isIf(s) && s.branch?.at === at && s.branch.arm === which).map((s) => stepTitle(fns, s));
  return flat
    .flatMap((s, i) => {
      if (!isIf(s)) return s.branch ? [] : [stepTitle(fns, s)];
      const otherwise = arm(i, 'else');
      return [`${stepTitle(fns, s)}: ${arm(i, 'then').join(' → ') || '—'}${otherwise.length ? ` | else: ${otherwise.join(' → ')}` : ''}`];
    })
    .join(' → ');
};

/**
 * `run` with every IF that is next in line decided on the values so far: the IF passes with the arm it
 * took and the value it tested, and the other arm's steps are skipped. A run with nothing left waiting passes.
 */
const settle = (run: FlowRun, now: number): FlowRun => {
  if (run.status !== 'running') return run;
  let steps = run.steps;
  for (let i = steps.findIndex((s) => s.status === 'waiting'); i >= 0 && isIf(steps[i]); i = steps.findIndex((s) => s.status === 'waiting')) {
    const cond = (steps[i] as FlatIf).if;
    const taken: Arm = conditionHolds(cond, run.values) ? 'then' : 'else';
    const tested = { [cond.value]: run.values[cond.value] ?? '' };
    steps = steps.map((s, j): FlowRunStep => {
      if (j === i) return { ...s, status: 'passed', taken, input: tested };
      return !isIf(s) && s.branch?.at === i && s.branch.arm !== taken ? { ...s, status: 'skipped' } : s;
    });
  }
  const done = !steps.some((s) => s.status === 'waiting' || s.status === 'running');
  return { ...run, steps, ...(done && { status: 'passed', endedAt: now }) };
};

/** A new run of `flow`, laid out flat (see {@link flatten}), every step waiting. Assumes {@link flowProblems} found nothing. */
export const newFlowRun = (fns: FunctionMeta[], flow: FlowDef, opts: { id: string; name: string; now: number; file?: string; env?: string }): FlowRun =>
  settle(
    {
      id: opts.id,
      name: opts.name,
      ...(opts.file && { file: opts.file }),
      ...(opts.env && { env: opts.env }),
      startedAt: opts.now,
      status: 'running',
      values: {},
      steps: flatten(flow).map((s) => ({ ...s, title: stepTitle(fns, s), status: 'waiting' })),
    },
    opts.now,
  );

/**
 * Index of the function step to run next, or -1 when the run is over or a step is running. IFs are
 * decided as soon as the steps before them end, so this never points at one.
 */
export const nextStepIndex = (run: FlowRun): number =>
  run.status !== 'running' || run.steps.some((s) => s.status === 'running') ? -1 : run.steps.findIndex((s) => s.status === 'waiting');

/** The function step at `index`; throws when it is an IF, which never runs as a function. */
export const fnStepAt = (run: FlowRun, index: number): FlatFn => {
  const step = run.steps[index];
  if (!step || isIf(step)) throw new Error(`flow step ${index + 1} is not a function step`);
  return step;
};

/**
 * `run` with step `index` started on `input`. `runId` is the History run the step started as; a step that
 * never started one has none.
 */
export const stepStarted = (run: FlowRun, index: number, input: Values, runId?: string): FlowRun => ({
  ...run,
  steps: run.steps.map((s, i) => (i === index ? { ...s, status: 'running', input, ...(runId && { runId }) } : s)),
});

/**
 * `run` after its running step ended. A passed step adds its outputs to `values`, any IF next in line is
 * decided, and the run passes when nothing is left waiting; a failed step fails the run and a stopped one
 * stops it.
 */
export const stepEnded = (run: FlowRun, result: { status: 'passed' | 'failed' | 'stopped'; output?: Values; error?: string }, now: number): FlowRun => {
  const index = run.steps.findIndex((s) => s.status === 'running');
  if (index < 0) return run;
  const steps = run.steps.map((s, i) => (i === index ? { ...s, status: result.status, ...(result.output && { output: result.output }), ...(result.error && { error: result.error }) } : s));
  if (result.status !== 'passed') return { ...run, steps, status: result.status, endedAt: now };
  return settle({ ...run, steps, values: { ...run.values, ...result.output } }, now);
};

const ended = (s: FlowRunStep) => s.status === 'failed' || s.status === 'stopped';

const envName = (env: string | undefined) => env || '.env.local';

/**
 * Why `run` can't be retried, or `undefined` when it can: it must have failed or been stopped at a step,
 * ran in the environment the app is on now (`env`, absent for `.env.local` alone), and every function
 * from that step on must still be among `functions` (ids).
 */
export const retryProblem = (run: FlowRun, opts: { env?: string; functions: string[] }): string | undefined => {
  if (run.status !== 'failed' && run.status !== 'stopped') return 'Only a failed or stopped flow run can be retried.';
  const from = run.steps.findIndex(ended);
  if (from < 0) return 'Nothing to retry: no step failed or was stopped.';
  if (envName(run.env) !== envName(opts.env))
    return `This run used ${envName(run.env)} and the app is on ${envName(opts.env)} now. Switch the app to ${envName(run.env)}, then retry.`;
  const gone = run.steps.findIndex((s, i) => i >= from && !isIf(s) && !opts.functions.includes(s.function));
  return gone < 0 ? undefined : `Step ${gone + 1}: function "${(run.steps[gone] as FlatFn).function}" is no longer in this repo.`;
};

/**
 * `run` set to go on from the step that failed or was stopped: that step waits again, the run is running,
 * and passed steps and the values passed along stay, so nothing before it runs again. The failed go moves
 * to the step's `tries`. A run with no such step comes back unchanged. Check {@link retryProblem} first.
 */
export const retriedFlowRun = (run: FlowRun): FlowRun => {
  const at = run.steps.findIndex(ended);
  if (at < 0) return run;
  const steps = run.steps.map((s, i): FlowRunStep => {
    if (i !== at) return s;
    const { status, error, runId, input: _input, output, tries, ...step } = s;
    const last: StepTry = { status: status as StepTry['status'], ...(error && { error }), ...(runId && { runId }), ...(output && { output }) };
    return { ...step, status: 'waiting', tries: [...(tries ?? []), last] };
  });
  const { endedAt: _endedAt, ...rest } = run;
  return { ...rest, status: 'running', steps };
};
