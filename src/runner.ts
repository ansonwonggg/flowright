import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FunctionMeta } from './fn.ts';
import { fnStepAt, newFlowRun, nextStepIndex, resolveInput, stepEnded, stepStarted, type FlowDef, type FlowRun } from './flow.ts';
import { FLOW_RUNS_DIR, writeFlowRun } from './flowRuns.ts';
import { newRunId } from './history.ts';
import { INPUT_ENV, OUTPUT_ENV, parseValues, type Values } from './io.ts';

/** How one function runs: given its inputs, it resolves with how it ended and what it gave out. */
export type Exec = (fn: FunctionMeta, input: Values, step: number) => Promise<{ status: 'passed' | 'failed' | 'stopped'; output?: Values; error?: string }>;

/**
 * An {@link Exec} that runs each function as its own Playwright run: `npx playwright test --project=<id>`
 * with the root's `playwright.config.ts`, inputs in `FLOWKIT_INPUT`, outputs read back from a file.
 * Output streams to this terminal. Ctrl+C stops the step, and with it the flow.
 */
export const playwrightExec =
  (root: string, runId: string, options: { headed?: boolean } = {}): Exec =>
  (fn, input, step) =>
    new Promise((resolve) => {
      const dir = path.join(root, FLOW_RUNS_DIR, runId);
      mkdirSync(dir, { recursive: true });
      const outFile = path.join(dir, `${step}-${fn.id}.json`);
      const args = ['playwright', 'test', '-c', path.join(root, 'playwright.config.ts'), `--project=${fn.id}`, ...(options.headed ? ['--headed'] : [])];
      const child = spawn('npx', args, { cwd: root, stdio: 'inherit', env: { ...process.env, [INPUT_ENV]: JSON.stringify(input), [OUTPUT_ENV]: outFile } });
      let stopped = false;
      const stop = () => {
        stopped = true;
      };
      process.once('SIGINT', stop);
      child.on('exit', (code) => {
        process.off('SIGINT', stop);
        if (stopped) return resolve({ status: 'stopped', error: 'stopped by Ctrl+C' });
        if (code !== 0) return resolve({ status: 'failed', error: `${fn.id} failed (exit ${code}); see its output above` });
        try {
          resolve({ status: 'passed', output: parseValues(readFileSync(outFile, 'utf8'), outFile) });
        } catch {
          resolve({ status: 'passed', output: {} });
        }
      });
    });

/**
 * Runs `flow` one step at a time with `exec`, passing outputs on by name, and keeps the run in
 * `out/flow-runs/<id>.json` after every step, where the app lists it too. Stops at the first step that fails or is stopped.
 *
 * Assumes `flowProblems` found nothing.
 *
 * @param exec - default {@link playwrightExec}; tests pass a fake.
 * @param onChange - called with the run after every change, e.g. to print progress.
 * @param file - the saved flow file, from `root`, kept on the run so the app can show it as that flow's last run.
 * @param env - the environment the run uses, kept on the run; the caller loads its vars into `process.env`.
 */
export const runFlow = async (
  root: string,
  fns: FunctionMeta[],
  flow: FlowDef,
  options: { name?: string; file?: string; env?: string; exec?: Exec; headed?: boolean; onChange?: (run: FlowRun) => void; now?: () => number } = {},
): Promise<FlowRun> => {
  const now = options.now ?? Date.now;
  const id = newRunId(new Date(now()));
  const exec = options.exec ?? playwrightExec(root, id, { headed: options.headed });
  const save = (run: FlowRun) => {
    writeFlowRun(run, root);
    options.onChange?.(run);
  };
  let run = newFlowRun(fns, flow, { id, name: options.name ?? flow.title ?? 'flow', now: now(), file: options.file, env: options.env });
  save(run);
  for (let i = nextStepIndex(run); i >= 0; i = nextStepIndex(run)) {
    const step = fnStepAt(run, i);
    const fn = fns.find((f) => f.id === step.function)!;
    const input = resolveInput(fn, step, run.values);
    run = stepStarted(run, i, input);
    save(run);
    run = stepEnded(run, await exec(fn, input, i + 1), now());
    save(run);
  }
  return run;
};
