import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunView } from './events.ts';

/** Folder, relative to the repo root, holding one `<run id>/` folder per run. */
export const HISTORY_DIR = 'out/runs';

/** Env var holding the id of the Playwright run in progress; `flowkitReporters` sets it. */
export const RUN_ID_ENV = 'FLOWKIT_RUN_ID';

/** A run id: `YYYYMMDD-HHMMSS-xxxx` in local time, so ids sort by start time. */
export const RUN_ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

/** Final Playwright statuses plus `running`, which a run keeps if its process was killed before it ended. */
export type RunStatus = 'running' | 'passed' | 'failed' | 'timedout' | 'interrupted';

/** A record a run made or changed, as it stood when the run ended. */
export type RunRecordRef = { kind: string; ref: string; stage: string; stageLabel: string; summary: string };

/**
 * One run as history keeps it, in `out/runs/<id>/run.json`. Written by the reporter at start and end.
 *
 * - `project` is the function id; `title` its title when the run started.
 * - `input` is the function's named inputs as the run got them (`FLOWKIT_INPUT`), with secrets masked.
 *   Runs from before flowkit kept a file path here instead; readers must treat a non-object as `{}`.
 */
export type RunRecord = {
  id: string;
  project: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  input: Record<string, string>;
  headed: boolean;
  view: RunView;
  records: RunRecordRef[];
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A new {@link RUN_ID} for `now`. `random` is injectable for tests. */
export const newRunId = (now = new Date(), random = Math.random): string =>
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')}`;

/** `out/runs/<id>` under `root`. @throws when `id` is not a {@link RUN_ID}, so a request can't reach other folders. */
export const runDir = (id: string, root = process.cwd()): string => {
  if (!RUN_ID.test(id)) throw new Error(`not a run id: ${id}`);
  return path.join(root, HISTORY_DIR, id);
};

/** Writes `run.json`, and `log.txt` when `log` is given, creating the folder. Replaces earlier copies. */
export const writeRun = (run: RunRecord, log?: string[], root = process.cwd()): void => {
  const dir = runDir(run.id, root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2));
  if (log) writeFileSync(path.join(dir, 'log.txt'), log.join('\n'));
};

/** Reads one run and its log; `undefined` when the id is malformed or the run has no readable `run.json`. */
export const readRun = (id: string, root = process.cwd()): { run: RunRecord; log: string[] } | undefined => {
  if (!RUN_ID.test(id)) return undefined;
  const dir = runDir(id, root);
  try {
    const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) as RunRecord;
    const logFile = path.join(dir, 'log.txt');
    return { run, log: existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n') : [] };
  } catch {
    return undefined;
  }
};

/** Whether the run has its own Playwright HTML report under `report/`. */
export const hasReport = (id: string, root = process.cwd()): boolean => RUN_ID.test(id) && existsSync(path.join(runDir(id, root), 'report', 'index.html'));

/** Every readable run, newest first, without logs. Skips folders that aren't run ids or have no `run.json`. */
export const listRuns = (root = process.cwd(), limit = 200): RunRecord[] => {
  let ids: string[];
  try {
    ids = readdirSync(path.join(root, HISTORY_DIR)).filter((d) => RUN_ID.test(d));
  } catch {
    return [];
  }
  return ids
    .sort()
    .reverse()
    .flatMap((id) => {
      const found = readRun(id, root);
      return found ? [found.run] : [];
    })
    .slice(0, limit);
};

/**
 * The status to show for a stored run. A run still `running` on disk that isn't the live one had its
 * process killed before it could finish, so it shows as `interrupted`.
 */
export const shownStatus = (run: Pick<RunRecord, 'id' | 'status'>, liveId?: string): RunStatus =>
  run.status === 'running' && run.id !== liveId ? 'interrupted' : run.status;
