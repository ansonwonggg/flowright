import path from 'node:path';
import type { FieldJson } from './fields.ts';
import type { FunctionMeta } from './fn.ts';
import { listRecords, RECORDS_DIR, type RecordFile } from './records.ts';
import type { RecordKind } from './settings.ts';

/**
 * A record with the stage it is at: the id of the last function that touched it (`new` when none), and
 * a label such as `[Admin] Vet · SUCCEED`, from that function's title and the `status` value it left.
 */
export type RecordView = RecordFile & { stage: string; stageLabel: string };

/** The stage of a record; see {@link RecordView}. History or values that aren't there count as empty. */
export const stageOf = (record: Pick<RecordFile, 'history' | 'values'>, fns: Pick<FunctionMeta, 'id' | 'title'>[]): { stage: string; stageLabel: string } => {
  const last = Array.isArray(record.history) ? record.history.at(-1)?.function : undefined;
  if (!last) return { stage: 'new', stageLabel: 'new' };
  const title = fns.find((f) => f.id === last)?.title ?? last;
  const status = record.values?.status;
  return { stage: last, stageLabel: status ? `${title} · ${status}` : title };
};

/** Every record under `<root>/out/records/`, newest first, with its stage. */
export const listRecordViews = (fns: Pick<FunctionMeta, 'id' | 'title'>[], root = process.cwd()): RecordView[] =>
  listRecords(path.join(root, RECORDS_DIR)).map((r) => ({ ...r, ...stageOf(r, fns) }));

const filled = (template: string, values: Record<string, string>): string | undefined => {
  let complete = true;
  const text = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!values[name]) complete = false;
    return values[name] ?? '';
  });
  return complete ? text : undefined;
};

/**
 * One line naming the record: its key, the kind's `summary` parts that have values, then its stage, e.g.
 * `DMD1 Company AP @ Acme etoe.a · Activate · ACTIVATED`. A kind with no settings shows key and stage.
 */
export const describeRecord = (record: Pick<RecordView, 'key' | 'kind' | 'values' | 'stageLabel'>, kinds: Record<string, RecordKind> = {}): string => {
  const values = record.values ?? {};
  const parts = (kinds[record.kind]?.summary ?? []).map((part) => filled(part, values));
  return [record.key, ...parts, `· ${record.stageLabel}`].filter(Boolean).join(' ');
};

/** The kind in words, e.g. `ER user`; the kind itself when the kit gives no label. */
export const kindLabel = (kind: string, kinds: Record<string, RecordKind> = {}): string => kinds[kind]?.label ?? kind;

/**
 * Every value a tester needs to use the record, as label/value rows: the stage, then registry order, then
 * names the registry lacks. Empty values are left out. Secrets are included in plain text: these are test
 * accounts, and the tester needs the password to log in.
 */
export const recordDetails = (record: Pick<RecordView, 'values' | 'stageLabel'>, fields: Pick<FieldJson, 'name' | 'label'>[]): [string, string][] => {
  const values = record.values ?? {};
  const known = fields.filter((f) => values[f.name]).map((f): [string, string] => [f.label, values[f.name]]);
  const unknown = Object.entries(values).filter(([name, v]) => v && !fields.some((f) => f.name === name));
  return [['Stage', record.stageLabel], ...known, ...unknown];
};

/**
 * Functions that take a record of `kind` by its key, in the order given: those declared on that kind that
 * don't make a new one. It says nothing about whether running one makes sense for a given record; that
 * is the tester's call.
 */
export const functionsOn = <F extends Pick<FunctionMeta, 'record' | 'starts'>>(kind: string, fns: F[]): F[] => fns.filter((f) => f.record === kind && !f.starts);

/** When each record last changed, keyed `kind/key`; what {@link changedRecords} compares against. */
export type RecordSnapshot = Map<string, string>;

/** A {@link RecordSnapshot} of `records`. */
export const snapshotRecords = (records: Pick<RecordFile, 'kind' | 'key' | 'updatedAt'>[]): RecordSnapshot => new Map(records.map((r) => [`${r.kind}/${r.key}`, r.updatedAt]));

/** Records that are new, or changed, since `before` was taken. Keeps the order of `after`; deleted ones aren't reported. */
export const changedRecords = <R extends Pick<RecordFile, 'kind' | 'key' | 'updatedAt'>>(before: RecordSnapshot, after: R[]): R[] =>
  after.filter((r) => before.get(`${r.kind}/${r.key}`) !== r.updatedAt);
