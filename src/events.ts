/** Env var that makes the reporter print events for the app; the app sets it on every run. */
export const EVENTS_ENV = 'FLOWKIT_EVENTS';

/** Marks a reporter line on stdout as an event for the app rather than log text. */
export const EVENT_PREFIX = '@@flow ';

/** What the reporter tells the app while a run is going, one per stdout line when `FLOWKIT_EVENTS=1`. */
export type FlowEvent =
  | { type: 'begin'; projects: string[]; tests: number }
  | { type: 'test-begin'; title: string }
  | { type: 'step-begin'; title: string; depth: number }
  | { type: 'step-end'; title: string; depth: number; ok: boolean; duration: number }
  | { type: 'test-end'; title: string; status: string; duration: number }
  | { type: 'failure'; test: string; step?: string; kind: string; title: string; hint: string; error: string }
  | { type: 'end'; status: string };

/** `event` as one stdout line, prefix included, without the trailing newline. */
export const encodeEvent = (event: FlowEvent): string => `${EVENT_PREFIX}${JSON.stringify(event)}`;

/**
 * Splits one stdout line into an event or plain log text. A prefixed line whose JSON is broken or has
 * no `type` is kept as log text, so nothing the run prints is lost.
 */
export const parseLine = (line: string): { event: FlowEvent } | { log: string } => {
  if (!line.startsWith(EVENT_PREFIX)) return { log: line };
  try {
    const event = JSON.parse(line.slice(EVENT_PREFIX.length));
    return event && typeof event.type === 'string' ? { event } : { log: line };
  } catch {
    return { log: line };
  }
};

/** One step as the app shows it. `startedAt` is epoch ms; `duration` is set once it ends. */
export type StepView = { title: string; status: 'running' | 'passed' | 'failed'; startedAt: number; duration?: number; steps: StepView[] };

/** One test of the run: the setup logins, then the flow itself. */
export type TestView = { title: string; status: 'running' | string; startedAt: number; duration?: number; steps: StepView[] };

/** A run's state built from its events; `status` stays `running` until the `end` event or the process exits. */
export type RunView = {
  status: 'running' | 'passed' | 'failed' | 'stopped';
  tests: TestView[];
  failures: Extract<FlowEvent, { type: 'failure' }>[];
};

/** An empty run, before any event. */
export const emptyRun = (): RunView => ({ status: 'running', tests: [], failures: [] });

const lastRunning = (steps: StepView[], title: string): StepView | undefined =>
  [...steps].reverse().find((s) => s.status === 'running' && s.title === title);

const withLast = <T>(items: T[], update: (item: T) => T): T[] => (items.length ? [...items.slice(0, -1), update(items[items.length - 1])] : items);

const updateStep = (steps: StepView[], title: string, update: (s: StepView) => StepView): StepView[] => {
  const target = lastRunning(steps, title);
  return target ? steps.map((s) => (s === target ? update(s) : s)) : steps;
};

/**
 * Applies one event to a run, returning a new view. Pure; `now` is the event's arrival time in epoch ms.
 *
 * Steps nest two levels: a depth-1 step goes under the last top-level step. A step event that arrives
 * before any test, or a depth-1 step with no top-level step open, is ignored.
 */
export const applyEvent = (run: RunView, event: FlowEvent, now: number): RunView => {
  switch (event.type) {
    case 'test-begin':
      return { ...run, tests: [...run.tests, { title: event.title, status: 'running', startedAt: now, steps: [] }] };
    case 'step-begin': {
      const step: StepView = { title: event.title, status: 'running', startedAt: now, steps: [] };
      return {
        ...run,
        tests: withLast(run.tests, (t) =>
          event.depth === 0 ? { ...t, steps: [...t.steps, step] } : { ...t, steps: withLast(t.steps, (top) => ({ ...top, steps: [...top.steps, step] })) },
        ),
      };
    }
    case 'step-end': {
      const end = (s: StepView): StepView => ({ ...s, status: event.ok ? 'passed' : 'failed', duration: event.duration });
      return {
        ...run,
        tests: withLast(run.tests, (t) =>
          event.depth === 0
            ? { ...t, steps: updateStep(t.steps, event.title, end) }
            : { ...t, steps: withLast(t.steps, (top) => ({ ...top, steps: updateStep(top.steps, event.title, end) })) },
        ),
      };
    }
    case 'test-end':
      return { ...run, tests: withLast(run.tests, (t) => ({ ...t, status: event.status, duration: event.duration })) };
    case 'failure':
      return { ...run, failures: [...run.failures, event] };
    case 'end':
      return { ...run, status: event.status === 'passed' ? 'passed' : 'failed' };
    default:
      return run;
  }
};
