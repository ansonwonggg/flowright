/**
 * Form config: plain JSON describing how the app draws a JSON field (`field.json({ form })`). The server
 * sends it to the page in `/api/meta`; the page renders any form from it.
 *
 * It describes only what the form looks like. Whether a value is valid is decided by the field's own
 * `validate`, which the server runs on every change.
 */

/**
 * A named list from `/api/meta` `options`: one the kit's `app.options` gives, or a record kind (e.g.
 * `er-user`), which lists those records.
 */
export type OptionSource = string;

/** One choice of a select or radio. */
export type Option = { value: string; label: string };

/**
 * Shows a field only when every named key currently holds one of the listed values. Keys are form keys
 * (dotted for nested values) or `$project`, the id of the function the form is for.
 */
export type ShowWhen = Record<string, (string | boolean)[]>;

type Base = { key: string; label: string; hint?: string; showWhen?: ShowWhen };

/** A row inside a `list` or `entries` field. `path` edits a `string[]` as `A > B > C`. */
export type ItemField =
  | (Base & { type: 'text'; placeholder?: string })
  | (Base & { type: 'path'; placeholder?: string; placeholderBy?: { key: string; values: Record<string, string> } })
  | (Base & { type: 'select'; options: OptionSource | Option[] });

/**
 * One field of a form. `key` is where the value lives in the value, dotted for nested objects.
 *
 * - `text` with `suggest`: free text, offering a named list as suggestions.
 * - `list`: rows of `item` fields; with `minRows` it always shows at least that many rows, filling with
 *   `newItem`, and an untouched filler row is not part of the value until it is edited.
 * - `entries`: an object edited as key/value rows; with `key: ''` it is the whole value.
 */
export type FormField =
  | (Base & { type: 'text'; placeholder?: string; suggest?: OptionSource })
  | (Base & { type: 'select'; options: OptionSource | Option[] })
  | (Base & { type: 'radio'; options: OptionSource | Option[] })
  | (Base & { type: 'checkbox' })
  | (Base & { type: 'note'; tone: 'ok' | 'warn' })
  | (Base & { type: 'list'; item: ItemField[]; newItem: Record<string, unknown>; addLabel: string; itemLabel: string; minRows?: number })
  | (Base & { type: 'entries'; keyField: ItemField; valueField: ItemField; addLabel: string; itemLabel: string });

/** The form for one JSON field. `blank` is the value a blank form starts from. */
export type FormConfig = { blank: Record<string, unknown>; fields: FormField[] };

type Join<K, P> = K extends string ? (P extends string ? (P extends '' ? K : `${K}.${P}`) : never) : never;

/** Dotted paths into `T`, two levels deep: `'company' | 'enrolment' | 'enrolment.scheme'`. */
export type SpecKey<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends unknown[] ? K : NonNullable<T[K]> extends object ? K | Join<K, keyof NonNullable<T[K]> & string> : K;
}[keyof T & string];

/** {@link FormField} whose `key` must be a {@link SpecKey} of `T`, for type-checked form definitions. */
export type TypedField<T> = FormField & { key: SpecKey<T> };
