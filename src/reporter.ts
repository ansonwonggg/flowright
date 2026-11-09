import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import type { Manifest } from './discover.ts';
import { applyEvent, emptyRun, encodeEvent, EVENTS_ENV, type FlowEvent, type RunView } from './events.ts';
import { classifyFailure, shortError } from './failure.ts';
import type { FieldJson } from './fields.ts';
import type { FunctionMeta } from './fn.ts';
import { HISTORY_DIR, RUN_ID, RUN_ID_ENV, writeRun, type RunRecord, type RunStatus } from './history.ts';
import { INPUT_ENV, parseValues } from './io.ts';
import { currentManifest } from './playwright.ts';
import { changedRecords, describeRecord, kindLabel, listRecordViews, nextForRecord, snapshotRecords, type RecordSnapshot, type RecordView } from './recordView.ts';
import { DEFAULT_SETTINGS, type KitSettings } from './settings.ts';

const color = (code: number) => (text: string) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = color(32);
const red = color(31);
const dim = color(2);
const bold = color(1);
const ANSI = /\u001b\[[0-9;]*m/g;

const seconds = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`);

const depth = (step: TestStep): number => {
  let d = 0;
  for (let s = step.parent; s; s = s.parent) if (s.category === 'test.step') d++;
  return d;
};

type Failed = { title: string; file: string; status: string; step?: string; message?: string };

const HEARTBEAT_MS = 30_000;
const MAX_LOG = 5000;

/**
 * The shell line that runs function `fn` on the record `key`, without the app: the kit's `command`,
 * after `env -u` for each of its `unsetEnv`.
 */
export const resumeLine = (settings: Pick<KitSettings, 'command' | 'unsetEnv'>, fn: Pick<FunctionMeta, 'id' | 'recordKey'>, key: string): string =>
  [settings.unsetEnv.length ? `env ${settings.unsetEnv.map((name) => `-u ${name}`).join(' ')}` : '', settings.command, fn.id, fn.recordKey ? `${fn.recordKey}=${key}` : '']
    .filter(Boolean)
    .join(' ');

/** Lines for one touched record: what it is, then how to take it further. */
export const recordLines = (record: RecordView, fns: FunctionMeta[], settings: KitSettings): string[] => [
  `  ${kindLabel(record.kind, settings.records).padEnd(7)}  ${describeRecord(record, settings.records)}`,
  ...nextForRecord(record, fns).map((f) => dim(`           next: ${f.title.padEnd(42)} ${resumeLine(settings, f, record.key)}`)),
];

/**
 * The inputs history keeps for a run: `FLOWKIT_INPUT`, with every secret field shown as `••••`. An input
 * that isn't JSON gives `{}`.
 */
export const runInput = (env: NodeJS.ProcessEnv, fields: FieldJson[]): Record<string, string> => {
  let values: Record<string, string>;
  try {
    values = parseValues(env[INPUT_ENV]);
  } catch {
    values = {};
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fields.some((f) => f.name === k && f.kind === 'secret') ? '••••' : v]));
};

const manifest = (): Pick<Manifest, 'functions' | 'fields' | 'settings'> => {
  try {
    return currentManifest();
  } catch {
    return { functions: [], fields: [], settings: DEFAULT_SETTINGS };
  }
};

/**
 * Prints a run as a tester reads it and keeps it in history. Add it with `flowkitReporters` from
 * `@ansonwonggg/flowright/playwright`, which also sets the run id and the HTML report folder.
 *
 * - Terminal: each named step with its result, a "still on" line after 30 s of silence, then the records
 *   the run made or changed under `out/records/`, with the functions to run on them next, and on failure
 *   what kind it was (the kit's `failures` first) and how to resume.
 * - History: when `FLOWKIT_RUN_ID` is set and the run includes a function, writes
 *   `out/runs/<id>/run.json` when the first test starts and at the end, and `log.txt` at the end. Runs
 *   with no function (e.g. unit tests), and runs where no test starts (e.g. `--list`), are not kept.
 * - With `FLOWKIT_EVENTS=1` (the app sets it) it also prints one `@@flow` JSON line per event.
 *
 * Shows `test.step` blocks two levels deep; Playwright's own actions and fixtures are hidden.
 */
export default class FlowReporter implements Reporter {
  private startedAt = Date.now();
  private before: RecordSnapshot = new Map();
  private readonly failed: Failed[] = [];
  private readonly failedStep = new Map<TestCase, string>();
  private readonly events = process.env[EVENTS_ENV] === '1';
  private open: { title: string; at: number }[] = [];
  private lastOutput = Date.now();
  private heartbeat?: NodeJS.Timeout;
  private view: RunView = emptyRun();
  private readonly log: string[] = [];
  private history?: RunRecord;
  private fns: FunctionMeta[] = [];
  private settings: KitSettings = DEFAULT_SETTINGS;
  private started = false;

  private emit(event: FlowEvent) {
    this.view = applyEvent(this.view, event, Date.now());
    if (this.events) console.log(encodeEvent(event));
  }

  private keep(text: string) {
    this.log.push(...text.replace(ANSI, '').replace(/\n$/, '').split('\n'));
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  private print(text: string) {
    this.lastOutput = Date.now();
    this.keep(text);
    console.log(text);
  }

  private beat() {
    const current = this.open.at(-1);
    if (!current || Date.now() - this.lastOutput < HEARTBEAT_MS) return;
    this.print(dim(`      … still on "${current.title}" (${seconds(Date.now() - current.at)})`));
  }

  private save(status: RunStatus, withLog: boolean) {
    if (!this.history || !this.started) return;
    this.history = { ...this.history, status, view: this.view, ...(status !== 'running' && { endedAt: Date.now() }) };
    try {
      writeRun(this.history, withLog ? this.log : undefined);
    } catch (e) {
      console.error(`Could not save run history: ${(e as Error).message}`);
    }
  }

  printsToStdio() {
    return true;
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.startedAt = Date.now();
    const found = manifest();
    this.fns = found.functions;
    this.settings = found.settings;
    this.before = snapshotRecords(listRecordViews(this.fns));
    const projects = [...new Set(suite.allTests().map((t) => t.parent.project()?.name).filter((n): n is string => Boolean(n)))];
    const id = process.env[RUN_ID_ENV];
    const main = projects.find((p) => this.fns.some((f) => f.id === p));
    if (id && RUN_ID.test(id) && main) {
      this.history = {
        id,
        project: main,
        title: this.fns.find((f) => f.id === main)?.title ?? main,
        startedAt: this.startedAt,
        status: 'running',
        input: runInput(process.env, found.fields),
        headed: config.projects.some((p) => p.use?.headless === false),
        view: this.view,
        records: [],
      };
    }
    this.emit({ type: 'begin', projects, tests: suite.allTests().length });
    this.print(bold(`\nRunning ${projects.join(', ')}  ·  ${suite.allTests().length} test(s)\n`));
    this.heartbeat = setInterval(() => this.beat(), 5_000);
    this.heartbeat.unref();
  }

  onTestBegin(test: TestCase) {
    if (!this.started) {
      this.started = true;
      this.save('running', false);
    }
    this.emit({ type: 'test-begin', title: test.title });
    this.print(`${bold('●')} ${test.title}`);
  }

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== 'test.step') return;
    const d = depth(step);
    if (d > 1) return;
    this.open.push({ title: step.title, at: Date.now() });
    this.emit({ type: 'step-begin', title: step.title, depth: d });
    if (d === 0) this.print(`  ${bold('▶')} ${step.title}`);
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== 'test.step') return;
    const d = depth(step);
    if (d > 1) return;
    const i = this.open.map((o) => o.title).lastIndexOf(step.title);
    if (i >= 0) this.open.splice(i, 1);
    if (step.error && d === 0) this.failedStep.set(test, step.title);
    if (step.error && d === 1 && !this.failedStep.has(test)) this.failedStep.set(test, step.title);
    this.emit({ type: 'step-end', title: step.title, depth: d, ok: !step.error, duration: step.duration });
    const mark = step.error ? red('✗') : green('✓');
    this.print(`${d ? '      ' : '  '}${mark} ${step.title} ${dim(seconds(step.duration))}`);
  }

  onStdOut(chunk: string | Buffer) {
    this.lastOutput = Date.now();
    this.keep(chunk.toString());
    process.stdout.write(dim(chunk.toString()));
  }

  onStdErr(chunk: string | Buffer) {
    this.keep(chunk.toString());
    process.stderr.write(chunk.toString());
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const ok = result.status === 'passed' || result.status === 'skipped';
    this.open = [];
    this.emit({ type: 'test-end', title: test.title, status: result.status, duration: result.duration });
    this.print(`  ${ok ? green(result.status) : red(result.status)} ${dim(seconds(result.duration))}\n`);
    if (!ok) {
      const failed: Failed = {
        title: test.title,
        file: test.location.file,
        status: result.status,
        step: this.failedStep.get(test),
        message: result.errors[0]?.message ?? result.error?.message,
      };
      this.failed.push(failed);
      const why = classifyFailure(failed.message, failed.file, failed.status, this.settings.failures);
      this.emit({ type: 'failure', test: failed.title, step: failed.step, kind: why.kind, title: why.title, hint: why.hint, error: shortError(failed.message, 20) });
    }
  }

  onEnd(result: FullResult) {
    clearInterval(this.heartbeat);
    this.emit({ type: 'end', status: result.status });
    const touched = changedRecords(this.before, listRecordViews(this.fns));
    const line = '─'.repeat(78);
    const out: string[] = [line];
    out.push(
      result.status === 'passed'
        ? green(bold(`PASSED in ${seconds(Date.now() - this.startedAt)}`))
        : red(bold(`${result.status.toUpperCase()} after ${seconds(Date.now() - this.startedAt)}`)),
    );

    if (touched.length) {
      out.push('', bold('Records made or updated in this run:'));
      for (const r of touched) out.push(...recordLines(r, this.fns, this.settings));
      out.push(dim("  Full details and logins: the app's Records page, or flowkit records"));
    } else if (result.status !== 'passed') {
      out.push('', 'No records were written under out/. If the failure came after a submit, DEV may still hold something the flow did not save.');
    }

    for (const f of this.failed) {
      const why = classifyFailure(f.message, f.file, f.status, this.settings.failures);
      out.push('', red(bold(`✗ ${why.title}`)), `  in:   ${f.title}`);
      if (f.step) out.push(`  step: ${f.step}`);
      out.push(`  what to do: ${why.hint}`, '', dim(shortError(f.message).replace(/^/gm, '  │ ')));
    }

    if (this.history && this.started) {
      const report = path.join(HISTORY_DIR, this.history.id, 'report');
      if (result.status !== 'passed') out.push('', `Screenshots and trace: npx playwright show-report ${report}`);
      out.push(dim(`Kept in history as ${this.history.id}`));
      this.history = {
        ...this.history,
        records: touched.map((r) => ({ kind: r.kind, ref: r.key, stage: r.stage, stageLabel: r.stageLabel, summary: describeRecord(r, this.settings.records) })),
      };
    }
    out.push(line, '');
    this.print(out.join('\n'));
    this.save(result.status, true);
  }
}
