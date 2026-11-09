import { valueProblem, type Fields } from '../fields.ts';
import type { FlowDef } from '../flow.ts';
import type { FunctionMeta } from '../fn.ts';
import { fillFromRecord, type RecordFile } from '../records.ts';
import { cleanValues, type Values } from '../values.ts';

const PRESET_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,59}$/;

/**
 * The file a preset is saved to, `config/<folder>/<name>.json`, from a name the page sent. One sub-folder
 * is allowed, e.g. `cr089/g5`.
 *
 * @param suffix - default `.json`; `.flow.json` for flows.
 */
export const presetPath = (folder: string, name: unknown, suffix = '.json'): { file: string } | { error: string } => {
  const raw = typeof name === 'string' ? name.trim().replace(/(\.flow)?\.json$/i, '') : '';
  const segments = raw.split('/');
  if (!raw || segments.length > 2 || !segments.every((s) => PRESET_SEGMENT.test(s)))
    return { error: 'Use lower-case letters, digits, . _ - and at most one folder, e.g. "other-user-pccw" or "cr089/g5".' };
  return { file: `config/${folder}/${raw}${suffix}` };
};

/**
 * The inputs a run of `fn` would get: only its declared names, as text (a JSON value written inline
 * becomes JSON text), with gaps filled from `record`, the saved record its key points at.
 */
export const filledInputs = (fn: Pick<FunctionMeta, 'inputs'>, values: Record<string, unknown>, record?: RecordFile): Values => {
  const given = cleanValues(values);
  const declared = Object.fromEntries(Object.keys(fn.inputs).flatMap((name) => (given[name] ? [[name, given[name]]] : [])));
  return fillFromRecord(fn.inputs, declared, record);
};

/** Everything wrong with `values` as `fn`'s inputs, one message each: required ones missing, or a value breaking its rule. */
export const inputProblems = (fn: Pick<FunctionMeta, 'inputs'>, fields: Fields, values: Values): string[] =>
  Object.entries(fn.inputs).flatMap(([name, need]) => {
    const value = values[name];
    if (!value) return need === 'required' ? [`${fields[name]?.label ?? name} is required`] : [];
    const problem = valueProblem(name, fields[name], value);
    return problem ? [problem] : [];
  });

const parse = (text: string | undefined): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * One line saying what a run was given: each JSON input in words (by its field's `describe`, in registry
 * order), then the values of `shown`. History from before flowkit kept a file path instead; that gives `''`.
 *
 * @param shown - the input names to show after the JSON ones; default every text and select input.
 */
export const summarize = (input: unknown, fields: Fields, shown?: string[]): string => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const v = input as Record<string, string>;
  const json = Object.entries(fields).flatMap(([name, f]) => (f.kind === 'json' && f.describe && v[name] ? [f.describe(parse(v[name]) as never)] : []));
  const names = shown ?? Object.entries(fields).flatMap(([name, f]) => (f.kind === 'text' || f.kind === 'select' ? [name] : []));
  return [...json, ...names.map((name) => v[name])].filter(Boolean).join(' · ');
};

/**
 * A flow the page sent, reduced to its title and group (trimmed, left out when blank) and each step's
 * function and values. Anything else is dropped; `flowProblems` then says what is wrong with what is left.
 */
export const cleanFlow = (body: unknown): FlowDef => {
  const raw = (body as { steps?: unknown; title?: unknown; group?: unknown } | null) ?? {};
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  return {
    ...(typeof raw.title === 'string' && raw.title.trim() && { title: raw.title.trim() }),
    ...(typeof raw.group === 'string' && raw.group.trim() && { group: raw.group.trim() }),
    steps: steps.map((s) => {
      const step = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const values = step.values && typeof step.values === 'object' && !Array.isArray(step.values) ? cleanValues(step.values as Record<string, unknown>) : {};
      return { function: typeof step.function === 'string' ? step.function : '', ...(Object.keys(values).length && { values }) };
    }),
  };
};
