import { flatten, isIf } from '../../../src/flow.ts';
import type { FlowRun, Preset } from '../api.ts';
import { groupOf } from './flowDraft.ts';

/** One saved flow as a row of the flow list. */
export type FlowRow = {
  /** From the repo root, e.g. `config/flows/new-er-user.flow.json`. Unique; the row's key. */
  file: string;
  label: string;
  /** Trimmed; `''` when the flow has none. */
  group: string;
  /** The step summary, `A → B → IF x: C`. */
  steps: string;
  /** Function steps, both arms of every IF included; IFs themselves don't count. */
  stepCount: number;
  /** Ms since epoch; absent when the server didn't send it. */
  modifiedAt?: number;
  /** The newest run started from this file; absent when it has none in the runs given. */
  lastRun?: FlowRun;
};

export type SortKey = 'name' | 'group' | 'steps' | 'lastRun' | 'modified';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Name, A to Z. */
export const DEFAULT_SORT: Sort = { key: 'name', dir: 'asc' };

const KEYS: SortKey[] = ['name', 'group', 'steps', 'lastRun', 'modified'];
const NEWEST_FIRST: SortKey[] = ['lastRun', 'modified'];

/**
 * A row per saved flow, in the order given. A run is the flow's last run only when its `file` is the flow's
 * file: runs from before flowright 0.1.7, or of a flow never saved, have none and match no flow.
 */
export const flowRows = (flows: Preset[], runs: FlowRun[]): FlowRow[] => {
  const lastByFile = new Map<string, FlowRun>();
  for (const run of runs) {
    if (!run.file) continue;
    const seen = lastByFile.get(run.file);
    if (!seen || run.startedAt > seen.startedAt) lastByFile.set(run.file, run);
  }
  return flows.map((f) => {
    const lastRun = lastByFile.get(f.file);
    return {
      file: f.file,
      label: f.label,
      group: groupOf(f.spec).trim(),
      steps: f.summary,
      stepCount: flatten(f.spec).filter((s) => !isIf(s)).length,
      ...(f.modifiedAt !== undefined && { modifiedAt: f.modifiedAt }),
      ...(lastRun && { lastRun }),
    };
  });
};

/**
 * The rows whose name, group, steps or file hold every word of `query`, ignoring case, in their order.
 * A blank query keeps every row.
 */
export const filterRows = (rows: FlowRow[], query: string): FlowRow[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const text = `${r.label} ${r.group} ${r.steps} ${r.file}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
};

const byName = (a: FlowRow, b: FlowRow) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }) || a.file.localeCompare(b.file);

const valueOf = (row: FlowRow, key: SortKey): string | number | undefined => {
  if (key === 'group') return row.group || undefined;
  if (key === 'steps') return row.stepCount;
  if (key === 'lastRun') return row.lastRun?.startedAt;
  if (key === 'modified') return row.modifiedAt;
  return undefined;
};

/**
 * A sorted copy of `rows`. Rows without the value (no group, never run, modified time unknown) go last in
 * both directions; ties and those rows go by name, A to Z. Names ignore case and order numbers by value.
 */
export const sortRows = (rows: FlowRow[], sort: Sort): FlowRow[] => {
  const sign = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'name') return [...rows].sort((a, b) => sign * byName(a, b));
  return [...rows].sort((a, b) => {
    const x = valueOf(a, sort.key);
    const y = valueOf(b, sort.key);
    if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1;
    const order = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, undefined, { sensitivity: 'base' }) : Number(x) - Number(y);
    return sign * order || byName(a, b);
  });
};

/** The sort after clicking `key`'s header: the same column flips; a new one starts A to Z, or newest first for times. */
export const nextSort = (current: Sort, key: SortKey): Sort => {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: NEWEST_FIRST.includes(key) ? 'desc' : 'asc' };
};

/** A sort saved as JSON by the page; {@link DEFAULT_SORT} for anything missing or not a valid sort. */
export const parseSort = (saved: string | null): Sort => {
  try {
    const value = JSON.parse(saved ?? '') as Partial<Sort> | null;
    if (value && KEYS.includes(value.key as SortKey) && (value.dir === 'asc' || value.dir === 'desc')) return { key: value.key as SortKey, dir: value.dir };
  } catch {
    return DEFAULT_SORT;
  }
  return DEFAULT_SORT;
};
