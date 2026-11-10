import { comesFromEarlier, flatten, flowSummary, isIf, producedBefore, type Arm, type Condition, type FlatFn, type FlowStep, type FnStep, type IfStep } from '../../../src/flow.ts';
import { toSpec, toValues, withSelectDefaults, type FormValues, type OptionLists } from '../../../src/forms/engine.ts';
import type { FormConfig } from '../../../src/forms/types.ts';
import type { FieldJson, FlowDef, FlowRun, Fn } from '../api.ts';

/**
 * One step as the builder edits it: the function, typed text values by name, and the form values of each
 * JSON input (e.g. a user spec).
 */
export type DraftStep = { key: string; fn: string; values: Record<string, string>; forms: Record<string, FormValues> };

/** How an IF compares its value: `equals` / `notEquals` the text in `to`, or `set` (any value; `to` unused). */
export type DraftOp = 'equals' | 'notEquals' | 'set';

/** An IF's condition as the builder edits it. */
export type DraftCondition = { value: string; op: DraftOp; to: string };

/** An IF as the builder edits it: its condition and the function steps of each arm. */
export type DraftIf = { key: string; kind: 'if'; cond: DraftCondition; then: DraftStep[]; else: DraftStep[] };

/** One top-level item of the builder: a function step or an IF. */
export type DraftItem = DraftStep | DraftIf;

/** Whether a builder item is an IF. */
export const isDraftIf = (item: DraftItem): item is DraftIf => 'kind' in item && item.kind === 'if';

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

/** A new IF with no condition and empty arms. */
export const newIf = (): DraftIf => ({ key: newKey(), kind: 'if', cond: { value: '', op: 'equals', to: '' }, then: [], else: [] });

const conditionDraft = (c: Partial<Condition> | undefined): DraftCondition => {
  const value = typeof c?.value === 'string' ? c.value : '';
  if (typeof c?.equals === 'string') return { value, op: 'equals', to: c.equals };
  if (typeof c?.notEquals === 'string') return { value, op: 'notEquals', to: c.notEquals };
  return { value, op: 'set', to: '' };
};

/**
 * A saved flow as items to edit. Unknown functions are kept, so the server can say what is wrong with
 * them; an IF inside an arm comes back as a step with no function.
 */
export const draftFrom = (fns: Fn[], fields: FieldJson[], def: unknown, options: OptionLists): DraftItem[] => {
  const steps = (def as FlowDef | undefined)?.steps;
  if (!Array.isArray(steps)) return [];
  const stepOf = (raw: unknown): DraftStep => {
    const step = raw as Partial<FnStep> | null | undefined;
    const fn = fns.find((f) => f.id === step?.function);
    const given = (step?.values ?? {}) as Record<string, unknown>;
    const values = Object.fromEntries(Object.entries(given).filter(([name, v]) => typeof v === 'string' && !formOf(fieldOf(fields, name))) as [string, string][]);
    return { key: newKey(), fn: String(step?.function ?? ''), values, forms: formsFor(fn, fields, options, given) };
  };
  const arm = (list: unknown) => (Array.isArray(list) ? list.map(stepOf) : []);
  return steps.map((step: unknown) =>
    isIf(step) ? { key: newKey(), kind: 'if' as const, cond: conditionDraft(step.if), then: arm((step as { then?: unknown }).then), else: arm((step as { else?: unknown }).else) } : stepOf(step),
  );
};

/**
 * The flow the server checks, runs or saves: title and group trimmed and left out when blank, blank text
 * values dropped, each JSON input built from its form and left out when it comes out empty.
 */
export const flowOf = (items: DraftItem[], fields: FieldJson[], title?: string, group?: string): FlowDef => {
  const stepOf = (step: DraftStep): FnStep => {
    const text = Object.entries(step.values).filter(([, v]) => v.trim() !== '');
    const json = Object.entries(step.forms).flatMap(([name, values]) => {
      const form = formOf(fieldOf(fields, name));
      const spec = form ? toSpec(form, values, step.fn) : {};
      return Object.keys(spec).length ? [[name, spec] as const] : [];
    });
    const values = Object.fromEntries([...text, ...json]);
    return { function: step.fn, ...(Object.keys(values).length && { values }) };
  };
  const ifOf = (item: DraftIf): FlowStep => {
    const { value, op, to } = item.cond;
    const cond: Condition = { value: value.trim(), ...(op === 'equals' && { equals: to.trim() }), ...(op === 'notEquals' && { notEquals: to.trim() }) };
    return { if: cond, then: item.then.map(stepOf), ...(item.else.length && { else: item.else.map(stepOf) }) };
  };
  return {
    ...(title?.trim() && { title: title.trim() }),
    ...(group?.trim() && { group: group.trim() }),
    steps: items.map((item) => (isDraftIf(item) ? ifOf(item) : stepOf(item))),
  };
};

export const flowOfRun = (run: FlowRun, fns: Fn[], fields: FieldJson[]): FlowDef => {
  const isSecret = (name: string) => fieldOf(fields, name)?.kind === 'secret';
  const stepOf = (step: FlatFn): FnStep => {
    const values = Object.fromEntries(Object.entries(step.values ?? {}).filter(([name]) => !isSecret(name)));
    return { function: step.function, ...(Object.keys(values).length && { values }) };
  };
  const flat = run.steps ?? [];
  const ifAt = new Map<number, IfStep>();
  const steps: FlowStep[] = [];
  flat.forEach((step, i) => {
    if (isIf(step)) {
      const made: IfStep = { if: step.if, then: [] };
      ifAt.set(i, made);
      steps.push(made);
      return;
    }
    const owner = step.branch && ifAt.get(step.branch.at);
    if (!owner) return steps.push(stepOf(step));
    if (step.branch!.arm === 'then') owner.then.push(stepOf(step));
    else owner.else = [...(owner.else ?? []), stepOf(step)];
  });
  const def: FlowDef = { steps };
  const name = run.name?.trim();
  return name && name !== flowSummary(fns, def) ? { title: name, ...def } : def;
};

/**
 * Each item's and arm step's index in the flow laid out flat (see `flatten`), by key: the index the flow
 * check's "Step n" messages count from, minus one.
 */
export const flatIndexes = (items: DraftItem[]): Map<string, number> => {
  const at = new Map<string, number>();
  for (const item of items) {
    at.set(item.key, at.size);
    if (isDraftIf(item)) for (const step of [...item.then, ...item.else]) at.set(step.key, at.size);
  }
  return at;
};

/** Every function step, arm steps included, in flat order. */
export const allSteps = (items: DraftItem[]): DraftStep[] => items.flatMap((item) => (isDraftIf(item) ? [...item.then, ...item.else] : [item]));

/** `items` with the function step keyed `key` (top level or in an arm) replaced by `next`. */
export const replaceStep = (items: DraftItem[], key: string, next: DraftStep): DraftItem[] =>
  items.map((item) => {
    if (item.key === key) return next;
    if (!isDraftIf(item)) return item;
    const swap = (list: DraftStep[]) => list.map((s) => (s.key === key ? next : s));
    return { ...item, then: swap(item.then), else: swap(item.else) };
  });

/** `items` without the item or arm step keyed `key`. */
export const removeKey = (items: DraftItem[], key: string): DraftItem[] =>
  items.flatMap((item): DraftItem[] => {
    if (item.key === key) return [];
    if (!isDraftIf(item)) return [item];
    return [{ ...item, then: item.then.filter((s) => s.key !== key), else: item.else.filter((s) => s.key !== key) }];
  });

/** `items` with the IF keyed `key` changed by `change`. */
export const updateIf = (items: DraftItem[], key: string, change: (item: DraftIf) => DraftIf): DraftItem[] =>
  items.map((item) => (item.key === key && isDraftIf(item) ? change(item) : item));

/** Names the IF at flat index `index` can test: what the steps before it are sure to give, in the order given. */
export const testableBefore = (fns: Fn[], flow: FlowDef, index: number): string[] => [...producedBefore(fns, flatten(flow), index).keys()];

/**
 * Where an input of step `index` (flat, see {@link flatIndexes}) will come from when left empty: the earlier step that gives it, or the
 * record (only for a required input: an optional one falls back to its default instead).
 */
export const inputSource = (fns: Fn[], flow: FlowDef, index: number, name: string, required: boolean): { step?: number; record?: boolean } => {
  const flat = flatten(flow);
  const step = producedBefore(fns, flat, index).get(name);
  if (step) return { step };
  return required && comesFromEarlier(fns, flat, index)(name) ? { record: true } : {};
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

/** What is being dragged: a function or the IF from the palette, or the item at index `from`. */
export type Dragged = { fn: string } | { if: true } | { from: number };

/**
 * For each gap of the flow (`ids.length + 1` of them), whether dropping `dragged` there changes the flow.
 * Any order is allowed; only gaps where a moved step would land where it already is are false.
 */
export const dropGaps = (ids: string[], dragged: Dragged): boolean[] =>
  Array.from({ length: ids.length + 1 }, (_, gap) => !('from' in dragged) || (gap !== dragged.from && gap !== dragged.from + 1));

/** An IF's arm, by the IF's key. */
export type Lane = { ifKey: string; arm: Arm };

/** A gap a step can go in: of the main line, or of `lane` when set (0 = before its first step). */
export type Place = { gap: number; lane?: Lane };

/**
 * What is being dragged: a function or the IF from the palette, a `copy` of a saved flow's items (fresh
 * keys, see {@link draftFrom}), or the item or arm step keyed `key`.
 */
export type Held = { fn: string } | { if: true } | { copy: DraftItem[] } | { key: string };

const sameLane = (a: Lane | undefined, b: Lane | undefined) => a?.ifKey === b?.ifKey && a?.arm === b?.arm;

const listAt = (items: DraftItem[], lane: Lane | undefined): DraftItem[] | undefined => {
  if (!lane) return items;
  const owner = items.find((item) => item.key === lane.ifKey);
  return owner && isDraftIf(owner) ? owner[lane.arm] : undefined;
};

const locate = (items: DraftItem[], key: string): { item: DraftItem; index: number; lane?: Lane } | undefined => {
  const top = items.findIndex((item) => item.key === key);
  if (top >= 0) return { item: items[top], index: top };
  for (const owner of items) {
    if (!isDraftIf(owner)) continue;
    for (const arm of ['then', 'else'] as const) {
      const index = owner[arm].findIndex((s) => s.key === key);
      if (index >= 0) return { item: owner[arm][index], index, lane: { ifKey: owner.key, arm } };
    }
  }
  return undefined;
};

/**
 * Whether dropping `held` at `place` changes the flow. An IF never goes into an arm, since arms hold
 * function steps only; a step dropped on either gap beside itself stays put; an arm of a missing IF takes nothing.
 */
export const canDrop = (items: DraftItem[], held: Held, place: Place): boolean => {
  if (!listAt(items, place.lane)) return false;
  if ('fn' in held) return true;
  if ('if' in held) return !place.lane;
  if ('copy' in held) return held.copy.length > 0 && !(place.lane && held.copy.some(isDraftIf));
  const from = locate(items, held.key);
  if (!from) return false;
  if (place.lane && isDraftIf(from.item)) return false;
  return !sameLane(from.lane, place.lane) || (place.gap !== from.index && place.gap !== from.index + 1);
};

const insertAllAt = <T>(list: T[], added: T[], at: number): T[] => {
  const gap = clamp(at, list.length);
  return [...list.slice(0, gap), ...added, ...list.slice(gap)];
};

/**
 * `items` with `added` put at `place`, in order. Unchanged when `added` is empty, or when it holds an IF
 * and `place` is an arm, or the arm's IF is missing.
 */
export const putAllAt = (items: DraftItem[], added: DraftItem[], place: Place): DraftItem[] => {
  const { lane } = place;
  if (!added.length) return items;
  if (!lane) return insertAllAt(items, added, place.gap);
  if (added.some(isDraftIf) || !listAt(items, lane)) return items;
  return updateIf(items, lane.ifKey, (it) => ({ ...it, [lane.arm]: insertAllAt(it[lane.arm], added as DraftStep[], place.gap) }));
};

/** `items` with `item` put at `place`; unchanged when an IF would go into an arm or the arm's IF is missing. */
export const putAt = (items: DraftItem[], item: DraftItem, place: Place): DraftItem[] => putAllAt(items, [item], place);

/**
 * `items` with the item or arm step keyed `key` moved to `place`, counted on the lists before the move;
 * unchanged when {@link canDrop} says no.
 */
export const moveKeyTo = (items: DraftItem[], key: string, place: Place): DraftItem[] => {
  const from = locate(items, key);
  if (!from || !canDrop(items, { key }, place)) return items;
  const gap = sameLane(from.lane, place.lane) && place.gap > from.index ? place.gap - 1 : place.gap;
  return putAt(removeKey(items, key), from.item, { ...place, gap });
};

const textOf = (def: unknown, key: 'title' | 'group'): string => {
  const value = def && typeof def === 'object' && !Array.isArray(def) ? (def as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value.trim() : '';
};

/** A saved flow's `title`, trimmed; blank when it has none or isn't a flow object. */
export const titleOf = (def: unknown): string => textOf(def, 'title');

/** A saved flow's `group`, trimmed; blank when it has none or isn't a flow object. */
export const groupOf = (def: unknown): string => textOf(def, 'group');
