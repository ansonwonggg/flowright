/** Free text, optionally matched against `pattern`. */
export type TextField = { kind: 'text'; label: string; pattern?: RegExp; placeholder?: string; hint?: string };
/** Text never saved in a flow file and masked when shown. */
export type SecretField = { kind: 'secret'; label: string; pattern?: RegExp; placeholder?: string; hint?: string };
/** One of `options`. `labels` gives an option a name to show in its place, e.g. `SEP` → `Self-employed person`. */
export type SelectField = { kind: 'select'; label: string; options: readonly string[]; labels?: Readonly<Record<string, string>>; hint?: string };
/**
 * A structured value, e.g. a user spec with its list of rights. It travels as JSON text; `run` gets it
 * parsed, typed as `T`.
 *
 * - `validate`: the value's own rules; returns one message per problem, empty when fine.
 * - `form`: plain JSON describing how the app draws it (see the app's form config).
 * - `presets`: a folder under `config/` where the app keeps saved values of it, e.g. `users`.
 * - `describe`: one line saying what a value is, for preset lists and run summaries. The value may be
 *   anything parsed from JSON, so check before reading it.
 * - `env`: env vars a value needs on top of the function's own, e.g. the login it names; the app warns
 *   before a run when `.env.local` lacks one. An entry `A|B` needs either.
 */
export type JsonField<T = unknown> = {
  kind: 'json';
  label: string;
  hint?: string;
  form?: unknown;
  presets?: string;
  validate?: (value: unknown) => string[];
  describe?: (value: Partial<T> | undefined) => string;
  env?: (value: Partial<T> | undefined) => string[];
  readonly type?: T;
};

/** One named value that steps, functions and flows pass around, e.g. `reference_no` or `mobile`. */
export type Field = TextField | SecretField | SelectField | JsonField;

/** The registry: every value name a repo uses, with its rule. Names are snake_case. */
export type Fields = Record<string, Field>;

/** The type `run` sees for a field: the parsed type of a JSON field, else a string. */
export type ValueOf<F> = F extends JsonField<infer T> ? T : string;

/** Builders for registry entries. */
export const field = {
  text: (options: Omit<TextField, 'kind'>): TextField => ({ kind: 'text', ...options }),
  secret: (options: Omit<SecretField, 'kind'>): SecretField => ({ kind: 'secret', ...options }),
  select: (options: Omit<SelectField, 'kind'>): SelectField => ({ kind: 'select', ...options }),
  json: <T>(options: Omit<JsonField<T>, 'kind' | 'type'>): JsonField<T> => ({ kind: 'json', ...options }),
};

const NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Declares a repo's registry. Keeping the literal type lets `createKit` type-check every input and
 * output name against it.
 *
 * @throws when a name isn't snake_case, or a select has no options.
 */
export const defineFields = <const F extends Fields>(fields: F): F => {
  for (const [name, f] of Object.entries(fields)) {
    if (!NAME.test(name)) throw new Error(`field "${name}" must be snake_case: a–z, 0–9 and _`);
    if (f.kind === 'select' && !f.options.length) throw new Error(`field "${name}" is a select with no options`);
  }
  return fields;
};

/**
 * `raw` as `run` should see it: the parsed value of a JSON field, else the text itself; or the problem
 * with it. An empty value is never checked here; whether it may be empty is the function's business.
 */
export const readValue = (name: string, f: Field | undefined, raw: string): { value: unknown } | { problem: string } => {
  if (!f) return { problem: `"${name}" is not in the field registry` };
  if (f.kind === 'select') return f.options.includes(raw) ? { value: raw } : { problem: `${name} "${raw}" must be one of ${f.options.join(', ')}` };
  if (f.kind === 'json') {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { problem: `${name} is not JSON` };
    }
    const problems = f.validate?.(value) ?? [];
    return problems.length ? { problem: `${name}: ${problems.join('; ')}` } : { value };
  }
  if (f.pattern && !f.pattern.test(raw)) return { problem: `${name} "${f.kind === 'secret' ? '••••' : raw}" doesn't match ${f.pattern}` };
  return { value: raw };
};

/** What is wrong with `raw` for `name`, or `undefined` when it is fine; see {@link readValue}. */
export const valueProblem = (name: string, f: Field | undefined, raw: string): string | undefined => {
  const read = readValue(name, f, raw);
  return 'problem' in read ? read.problem : undefined;
};

/** A field as JSON, for the manifest and an app: a pattern becomes its source text; functions are left out. */
export type FieldJson = {
  name: string;
  kind: Field['kind'];
  label: string;
  pattern?: string;
  placeholder?: string;
  hint?: string;
  options?: readonly string[];
  labels?: Readonly<Record<string, string>>;
  form?: unknown;
  presets?: string;
};

export const fieldJson = (name: string, f: Field): FieldJson => ({
  name,
  kind: f.kind,
  label: f.label,
  ...(f.hint && { hint: f.hint }),
  ...((f.kind === 'text' || f.kind === 'secret') && f.pattern && { pattern: f.pattern.source }),
  ...((f.kind === 'text' || f.kind === 'secret') && f.placeholder && { placeholder: f.placeholder }),
  ...(f.kind === 'select' && { options: f.options }),
  ...(f.kind === 'select' && f.labels && { labels: f.labels }),
  ...(f.kind === 'json' && f.form !== undefined && { form: f.form }),
  ...(f.kind === 'json' && f.presets && { presets: f.presets }),
});

/** The registry entry back from its JSON, e.g. in a process that only has the manifest. A JSON field loses its functions. */
export const fieldFromJson = (json: FieldJson): Field => {
  const hint = json.hint ? { hint: json.hint } : {};
  if (json.kind === 'select') return { kind: 'select', label: json.label, options: json.options ?? [], ...hint, ...(json.labels && { labels: json.labels }) };
  if (json.kind === 'json') return { kind: 'json', label: json.label, ...hint, ...(json.form !== undefined && { form: json.form }), ...(json.presets && { presets: json.presets }) };
  return {
    kind: json.kind,
    label: json.label,
    ...hint,
    ...(json.pattern && { pattern: new RegExp(json.pattern) }),
    ...(json.placeholder && { placeholder: json.placeholder }),
  };
};
