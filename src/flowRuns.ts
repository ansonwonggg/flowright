import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FlowRun } from './flow.ts';
import { parseValues, type Values } from './io.ts';
import { RUN_ID } from './history.ts';

/** Folder, relative to the repo root, holding one `<id>.json` per flow run , from the app or the CLI. */
export const FLOW_RUNS_DIR = 'out/flow-runs';

const fileOf = (id: string, root: string) => {
  if (!RUN_ID.test(id)) throw new Error(`not a flow run id: ${id}`);
  return path.join(root, FLOW_RUNS_DIR, `${id}.json`);
};

/** Writes `run` to `out/flow-runs/<id>.json`, creating the folder. @throws when `run.id` isn't a run id. */
export const writeFlowRun = (run: FlowRun, root: string): void => {
  const file = fileOf(run.id, root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(run, null, 2));
};

/** The flow run saved under `id`, or `undefined` when the id is malformed or the file is missing or not JSON. */
export const readFlowRun = (id: string, root: string): FlowRun | undefined => {
  try {
    return JSON.parse(readFileSync(fileOf(id, root), 'utf8'));
  } catch {
    return undefined;
  }
};

/** Saved flow runs, newest first, at most `limit`. Files that aren't flow runs are skipped. */
export const listFlowRuns = (root: string, limit = 50): FlowRun[] => {
  let names: string[];
  try {
    names = readdirSync(path.join(root, FLOW_RUNS_DIR));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => readFlowRun(n.replace(/\.json$/, ''), root))
    .filter((r): r is FlowRun => Boolean(r && Array.isArray(r.steps)))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
};

/** The outputs a function wrote to `file`, or `undefined` when there is no file or it isn't a JSON object. */
export const readOutput = (file: string): Values | undefined => {
  try {
    return parseValues(readFileSync(file, 'utf8'), file);
  } catch {
    return undefined;
  }
};
