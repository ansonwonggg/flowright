import type { FormConfig, FormField, ItemField, ShowWhen } from './types.ts';

/** Form values: the spec's shape, with `list` rows and `entries` rows as arrays the form can edit. */
export type FormValues = Record<string, unknown>;

/** One row of an `entries` field while it is edited. */
export type EntryRow = { key: string; value: string };

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The value at a dotted `key`; `undefined` when any part of the path is missing or not an object. */
export const getAt = (values: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((v, part) => (isRecord(v) ? v[part] : undefined), values);

/** A copy of `values` with `value` set at a dotted `key`, creating objects along the way. Pure. */
export const setAt = (values: FormValues, key: string, value: unknown): FormValues => {
  const [head, ...rest] = key.split('.');
  if (!rest.length) return { ...values, [head]: value };
  const child = isRecord(values[head]) ? (values[head] as FormValues) : {};
  return { ...values, [head]: setAt(child, rest.join('.'), value) };
};

/**
 * Whether a field with this `showWhen` is shown for `values`. Every key must hold one of its listed
 * values; `$project` is compared with `project`. No `showWhen` means always shown.
 */
export const isShown = (showWhen: ShowWhen | undefined, values: FormValues, project = ''): boolean =>
  !showWhen ||
  Object.entries(showWhen).every(([key, allowed]) => allowed.includes((key === '$project' ? project : getAt(values, key)) as string | boolean));

/** `A > B > C` → `['A', 'B', 'C']`, trimmed, empty parts dropped. */
export const splitPath = (text: string): string[] =>
  text
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean);

/** `['A', 'B']` → `A > B`. Anything that isn't an array of strings gives `''`. */
export const joinPath = (path: unknown): string => (Array.isArray(path) ? path.filter((p) => typeof p === 'string').join(' > ') : '');

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);

const itemToSpec = (fields: ItemField[], row: unknown): Record<string, unknown> =>
  Object.fromEntries(
    fields.map((f) => {
      const raw = isRecord(row) ? row[f.key] : undefined;
      if (f.type === 'path') return [f.key, Array.isArray(raw) ? raw.filter((s) => typeof s === 'string' && s.trim()) : splitPath(String(raw ?? ''))];
      return [f.key, typeof raw === 'string' ? raw.trim() : raw];
    }),
  );

const fieldToSpec = (field: FormField, value: unknown): unknown => {
  if (field.type === 'text') return typeof value === 'string' ? value.trim() : value;
  if (field.type === 'list') return (Array.isArray(value) ? value : []).map((row) => itemToSpec(field.item, row));
  if (field.type === 'entries')
    return Object.fromEntries(
      (Array.isArray(value) ? (value as EntryRow[]) : [])
        .filter((r) => (r?.key ?? '').trim() || (r?.value ?? '').trim())
        .map((r) => [(r.key ?? '').trim(), r.value ?? '']),
    );
  return value;
};

/**
 * Turns form values into the spec the flow reads.
 *
 * Hidden fields (by `showWhen`) and `note` fields are left out, as are empty values (`''`, `false`,
 * `[]`, `undefined`), so optional fields don't appear in the spec. Text is trimmed and `path` text is
 * split on `>`. An `entries` field whose key is `''` becomes the whole spec (e.g. an accounts list).
 */
export const toSpec = (form: FormConfig, values: FormValues, project = ''): Record<string, unknown> => {
  let spec: FormValues = {};
  for (const field of form.fields) {
    if (field.type === 'note' || !isShown(field.showWhen, values, project)) continue;
    const value = fieldToSpec(field, field.key ? getAt(values, field.key) : values[''] );
    if (field.key === '' && isRecord(value)) return value;
    if (!isEmpty(value)) spec = setAt(spec, field.key, value);
  }
  return spec;
};

/**
 * Turns a spec (a preset, a run's snapshot, or `form.blank`) into form values: `entries` become editable
 * rows, `path` arrays stay arrays. A non-object spec gives the blank form. Pure.
 */
export const toValues = (form: FormConfig, spec: unknown): FormValues => {
  const blank = isRecord(form.blank) ? form.blank : {};
  const source = isRecord(spec) ? spec : blank;
  let values: FormValues = JSON.parse(JSON.stringify(source));
  for (const field of form.fields) {
    if (field.type === 'entries') {
      const obj = field.key ? getAt(source, field.key) : source;
      const rows: EntryRow[] = isRecord(obj) ? Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? '') })) : [];
      values = field.key ? setAt(values, field.key, rows) : { '': rows };
    }
    if (field.type === 'list' && !Array.isArray(getAt(values, field.key))) values = setAt(values, field.key, []);
  }
  return values;
};

/** The keys typed so far in an `entries` field, for `entryKeys:<key>` options. Empty keys are skipped. */
export const entryKeys = (values: FormValues, key: string): string[] => {
  const rows = key ? getAt(values, key) : values[''];
  return (Array.isArray(rows) ? (rows as EntryRow[]) : []).map((r) => (r?.key ?? '').trim()).filter(Boolean);
};

/** Live option lists by source name, as `/api/meta` `options` sends them. */
export type OptionLists = Partial<Record<string, { value: string; label: string }[]>>;

/**
 * Fills each shown, empty top-level `select` or `radio` with its first option, so a blank form starts
 * on a real choice (e.g. the first creator in `.env.local`). Values already set are kept. Pure.
 */
export const withSelectDefaults = (form: FormConfig, values: FormValues, options: OptionLists, project = ''): FormValues =>
  form.fields.reduce((acc, field) => {
    if ((field.type !== 'select' && field.type !== 'radio') || !isShown(field.showWhen, acc, project)) return acc;
    if (!isEmpty(getAt(acc, field.key))) return acc;
    const first = (typeof field.options === 'string' ? options[field.options] : field.options)?.[0]?.value;
    return first === undefined ? acc : setAt(acc, field.key, first);
  }, values);

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isRecord(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};

/** Whether two specs hold the same data, ignoring key order. */
export const sameSpec = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

/** The rows a `list` field shows: its rows, padded with copies of `newItem` up to `minRows`. Pure. */
export const shownRows = (rows: unknown, newItem: Record<string, unknown>, minRows = 0): Record<string, unknown>[] => {
  const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  return list.length >= minRows ? list : [...list, ...Array.from({ length: minRows - list.length }, () => structuredClone(newItem))];
};
