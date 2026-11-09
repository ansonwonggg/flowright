import type { RunRecordRef } from '../../../src/index.ts';
import type { Fn, HistoryItem, RecordRow } from '../api.ts';

/** One row of a function's section: a run, the record it made or moved on (if any), and that record now. */
export type FunctionRow = { key: string; run: HistoryItem; made?: RunRecordRef; current?: RecordRow };

/** One function with its rows, newest first, and how many of its runs passed and failed. */
export type FunctionGroup = { fn: Fn; rows: FunctionRow[]; passed: number; failed: number };

const FINISHED = (status: string) => status !== 'running' && status !== 'stopping';

const rowText = (row: FunctionRow) =>
  [row.run.title, row.run.summary, ...Object.values(row.run.input ?? {}), row.made?.ref, row.made?.summary, ...(row.current?.details ?? []).map(([, v]) => v)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

/**
 * Groups finished runs by the function that ran, in the order given, for the Records page.
 *
 * - A run that made or changed records gives one row per record; one that touched none gives a single row
 *   without `made`, so a failure that saved nothing still shows.
 * - Runs still going, and runs of functions not in `fns`, are left out.
 * - `kind` keeps functions on that kind of record (`'all'` keeps every one, including those with no record);
 *   `query` matches function, parameters, ref and the record's current details, ignoring case. Groups with
 *   no rows left are dropped.
 * - `passed` / `failed` count distinct runs in the filtered rows.
 */
export const groupByFunction = (fns: Fn[], runs: HistoryItem[], records: RecordRow[], kind: string, query: string): FunctionGroup[] => {
  const q = query.trim().toLowerCase();
  const current = new Map(records.map((r) => [`${r.kind}/${r.key}`, r]));
  return fns
    .filter((fn) => kind === 'all' || fn.record === kind)
    .map((fn) => {
      const rows = runs
        .filter((run) => run.project === fn.id && FINISHED(run.status))
        .flatMap((run): FunctionRow[] =>
          (run.records ?? []).length ? run.records.map((made) => ({ key: `${run.id}:${made.ref}`, run, made, current: current.get(`${made.kind}/${made.ref}`) })) : [{ key: run.id, run }],
        )
        .filter((row) => !q || rowText(row).includes(q));
      const statuses = [...new Map(rows.map((r) => [r.run.id, r.run.status])).values()];
      return { fn, rows, passed: statuses.filter((s) => s === 'passed').length, failed: statuses.filter((s) => s !== 'passed').length };
    })
    .filter((group) => group.rows.length > 0);
};
