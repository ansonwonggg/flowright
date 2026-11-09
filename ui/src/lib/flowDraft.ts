import { comesFromEarlier, nextFunctions, producedBefore } from '../../../src/flow.ts';
import { toSpec, toValues, withSelectDefaults, type FormValues, type OptionLists } from '../../../src/forms/engine.ts';
import type { FormConfig } from '../../../src/forms/types.ts';
import type { FieldJson, FlowDef, Fn } from '../api.ts';

/**
 * One step as the builder edits it: the function, typed text values by name, and the form values of each
 * JSON input (e.g. a user spec).
 */
export type DraftStep = { key: string; fn: string; values: Record<string, string>; forms: Record<string, FormValues> };

/** The form config a JSON field carries, when it has one. */
export const formOf = (field: FieldJson | undefined): FormConfig | undefined =>
  field?.kind === 'json' && field.form && typeof field.form === 'object' && 'fields' in field.form ? (field.form as FormConfig) : undefined;

const fieldOf = (fields: FieldJson[], name: string) => fields.find((f) => f.name === name);

const newKey = () => crypto.randomUUID();

const formsFor = (fn: Fn | undefined, fields: FieldJson[], options: OptionLists, values: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(fn?.inputs ?? {}).flatMap((name) => {
      const form = formOf(fieldOf(fields, name));
      return form ? [[name, withSelectDefaults(form, toValues(form, values[name]), options, fn!.id)]] : [];
    }),
  );

/** A new step for function `id`; each JSON input starts from its form's blank value, with select defaults filled. */
export const newStep = (fns: Fn[], fields: FieldJson[], id: string, options: OptionLists): DraftStep => ({
  key: newKey(),
  fn: id,
  values: {},
  forms: formsFor(fns.find((f) => f.id === id), fields, options, {}),
});

/** A saved flow as steps to edit. Unknown functions are kept, so the server can say what is wrong with them. */
export const draftFrom = (fns: Fn[], fields: FieldJson[], def: unknown, options: OptionLists): DraftStep[] => {
  const steps = (def as FlowDef | undefined)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => {
    const fn = fns.find((f) => f.id === step?.function);
    const raw = (step?.values ?? {}) as Record<string, unknown>;
    const values = Object.fromEntries(Object.entries(raw).filter(([name, v]) => typeof v === 'string' && !formOf(fieldOf(fields, name))) as [string, string][]);
    return { key: newKey(), fn: String(step?.function ?? ''), values, forms: formsFor(fn, fields, options, raw) };
  });
};

/**
 * The flow the server checks, runs or saves: title and group trimmed and left out when blank, blank text
 * values dropped, each JSON input built from its form and left out when it comes out empty.
 */
export const flowOf = (steps: DraftStep[], fields: FieldJson[], title?: string, group?: string): FlowDef => ({
  ...(title?.trim() && { title: title.trim() }),
  ...(group?.trim() && { group: group.trim() }),
  steps: steps.map((step) => {
    const text = Object.entries(step.values).filter(([, v]) => v.trim() !== '');
    const json = Object.entries(step.forms).flatMap(([name, values]) => {
      const form = formOf(fieldOf(fields, name));
      const spec = form ? toSpec(form, values, step.fn) : {};
      return Object.keys(spec).length ? [[name, spec] as const] : [];
    });
    const values = Object.fromEntries([...text, ...json]);
    return { function: step.fn, ...(Object.keys(values).length && { values }) };
  }),
});

/**
 * Where an input of step `index` will come from when left empty: the earlier step that gives it, or the
 * record (only for a required input: an optional one falls back to its default instead).
 */
export const inputSource = (fns: Fn[], flow: FlowDef, index: number, name: string, required: boolean): { step?: number; record?: boolean } => {
  const step = producedBefore(fns, flow.steps, index).get(name);
  if (step) return { step };
  return required && comesFromEarlier(fns, flow.steps, index)(name) ? { record: true } : {};
};

/** What an empty input of step `index` shows: where its value will come from, else the field's placeholder, or "required". */
export const placeholderFor = (fns: Fn[], flow: FlowDef, index: number, field: FieldJson, required: boolean): string => {
  const source = inputSource(fns, flow, index, field.name, required);
  if (source.step) return `from step ${source.step}`;
  if (source.record) return 'from the record';
  return field.placeholder ?? (required ? 'required' : '');
};

const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);

/** `list` with `item` put in gap `at` (0 = before the first, `list.length` = after the last); out-of-range gaps are clamped. */
export const insertAt = <T>(list: T[], item: T, at: number): T[] => {
  const gap = clamp(at, list.length);
  return [...list.slice(0, gap), item, ...list.slice(gap)];
};

/** `list` with the item at `from` moved into gap `to`, counted on the list before the move. A bad `from` changes nothing. */
export const moveTo = <T>(list: T[], from: number, to: number): T[] => {
  if (from < 0 || from >= list.length) return list;
  const rest = list.filter((_, i) => i !== from);
  const gap = clamp(to, list.length);
  return insertAt(rest, list[from], gap > from ? gap - 1 : gap);
};

/**
 * Whether functions `ids` may run in this order: only the first may make a new record, and the rest must
 * work on the same kind of record. Unknown ids are skipped, so the server can name them instead.
 */
export const inOrder = (fns: Fn[], ids: string[]): boolean =>
  ids.every((id, i) => i === 0 || !fns.some((f) => f.id === id) || nextFunctions(fns, ids.slice(0, i).map((f) => ({ function: f }))).some((f) => f.id === id));

/** What is being dragged: a function from the palette, or the step at index `from`. */
export type Dragged = { fn: string } | { from: number };

/**
 * For each gap of the flow (`ids.length + 1` of them), whether dropping `dragged` there keeps the flow in
 * order. Gaps where a moved step would land where it already is are false.
 */
export const dropGaps = (fns: Fn[], ids: string[], dragged: Dragged): boolean[] =>
  Array.from({ length: ids.length + 1 }, (_, gap) => {
    if ('fn' in dragged) return inOrder(fns, insertAt(ids, dragged.fn, gap));
    if (gap === dragged.from || gap === dragged.from + 1) return false;
    return inOrder(fns, moveTo(ids, dragged.from, gap));
  });

const textOf = (def: unknown, key: 'title' | 'group'): string => {
  const value = def && typeof def === 'object' && !Array.isArray(def) ? (def as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value.trim() : '';
};

/** A saved flow's `title`, trimmed; blank when it has none or isn't a flow object. */
export const titleOf = (def: unknown): string => textOf(def, 'title');

/** A saved flow's `group`, trimmed; blank when it has none or isn't a flow object. */
export const groupOf = (def: unknown): string => textOf(def, 'group');
