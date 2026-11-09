import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Need } from './contract.ts';
import type { Values } from './io.ts';

/**
 * What the framework keeps about one record, e.g. one ER user, as `<dir>/<kind>/<key>.json`.
 *
 * - `values`: every output any function gave for it, the latest winning. Secrets included: these are
 *   test accounts, and a later function needs the password to log in. Keep the folder git-ignored.
 * - `history`: each function that touched it, when, and what it gave.
 */
export type RecordFile = {
  kind: string;
  key: string;
  createdAt: string;
  updatedAt: string;
  values: Values;
  history: { function: string; at: string; output: Values }[];
};

/** Default folder, relative to where the run starts (the repo root). */
export const RECORDS_DIR = 'out/records';

const KIND = /^[a-z][a-z0-9-]*$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The file of one record. @throws when the kind or key could escape the folder. */
export const recordPath = (dir: string, kind: string, key: string): string => {
  if (!KIND.test(kind)) throw new Error(`record kind "${kind}" must be kebab-case`);
  if (!KEY.test(key)) throw new Error(`record key "${key}" may only hold letters, digits, . _ -`);
  return path.join(dir, kind, `${key}.json`);
};

/** The record, or `undefined` when it isn't saved or isn't JSON. */
export const readRecord = (dir: string, kind: string, key: string | undefined): RecordFile | undefined => {
  if (!key) return undefined;
  try {
    return JSON.parse(readFileSync(recordPath(dir, kind, key), 'utf8'));
  } catch {
    return undefined;
  }
};

/**
 * Adds a function's outputs to its record, creating the record when it is new.
 *
 * @returns the record as saved.
 */
export const saveRecord = (dir: string, change: { kind: string; key: string; fn: string; output: Values; now: Date }): RecordFile => {
  const at = change.now.toISOString();
  const before = readRecord(dir, change.kind, change.key);
  const record: RecordFile = {
    kind: change.kind,
    key: change.key,
    createdAt: before?.createdAt ?? at,
    updatedAt: at,
    values: { ...before?.values, ...change.output },
    history: [...(before?.history ?? []), { function: change.fn, at, output: change.output }],
  };
  const file = recordPath(dir, change.kind, change.key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
};

/** Every saved record, newest first. Files that aren't records are skipped. */
export const listRecords = (dir: string): RecordFile[] => {
  let kinds: string[];
  try {
    kinds = readdirSync(dir);
  } catch {
    return [];
  }
  return kinds
    .filter((kind) => KIND.test(kind))
    .flatMap((kind) => {
      let names: string[];
      try {
        names = readdirSync(path.join(dir, kind));
      } catch {
        return [];
      }
      return names.filter((n) => n.endsWith('.json')).map((n) => readRecord(dir, kind, n.slice(0, -'.json'.length)));
    })
    .filter((r): r is RecordFile => Boolean(r?.values && Array.isArray(r.history)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

/** `raw` with each declared input it lacks taken from the record's saved values. */
export const fillFromRecord = (inputs: Record<string, Need>, raw: Values, record: RecordFile | undefined): Values => {
  if (!record) return raw;
  const filled = { ...raw };
  for (const name of Object.keys(inputs)) if (!filled[name]?.trim() && record.values[name]) filled[name] = record.values[name];
  return filled;
};
