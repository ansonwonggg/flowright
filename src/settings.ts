import type { FailureRule } from './failure.ts';
import type { FlowDef } from './flow.ts';
import type { RecordView } from './recordView.ts';

/**
 * How the app and the reporter show one kind of record.
 *
 * - `key`: the field that names a record of this kind, e.g. `reference_no`.
 * - `label`: the kind in words, e.g. `ER user`; default the kind itself.
 * - `summary`: parts of the one-line description after the key, each a template such as `@ {company}`.
 *   A part with any `{name}` the record has no value for is left out.
 */
export type RecordKind = { key: string; label: string; summary: string[] };

/**
 * A kit's settings as JSON, so the reporter (which only has the manifest) sees them too.
 *
 * - `title`: the app's name in its header and tab.
 * - `command`: how a tester runs one function from a shell, before the function id, e.g. `npm run fn --`.
 * - `unsetEnv`: env vars removed before every run (e.g. a proxy that blocks the test site); the resume
 *   line printed after a run starts with `env -u` for each.
 * - `failures`: the kit's own ways to explain a failure, tried before the built-in ones.
 */
export type KitSettings = {
  title: string;
  records: Record<string, RecordKind>;
  command: string;
  unsetEnv: string[];
  failures: FailureRule[];
};

/** Settings of a repo with no functions yet, or a kit that sets none. */
export const DEFAULT_SETTINGS: KitSettings = { title: 'flowright', records: {}, command: 'npx flowright run .', unsetEnv: [], failures: [] };

/** One choice in a form list. */
export type Option = { value: string; label: string };

/** A saved value of a JSON field, from `config/<presets folder>/`. `value` is `undefined` when the file isn't JSON. */
export type Preset = { file: string; label: string; value: unknown };

/** What the app knows when it asks the kit for its form lists. */
export type AppContext = {
  /** The process env with `.env.local` on top. Read names from it; never send values to the page. */
  env: Record<string, string | undefined>;
  records: RecordView[];
  /** Presets by field name. */
  presets: Record<string, Preset[]>;
  flows: FlowDef[];
};

/**
 * What the kit adds to the app. These are functions, so they stay in the app's process and never reach
 * the manifest.
 *
 * - `options`: named lists a JSON field's form can use as choices or suggestions, worked out afresh for
 *   every page load. A list named after a record kind (e.g. `er-user`) is filled with those records for you.
 * - `summary`: the input names shown, after JSON fields' descriptions, in the one-line summary of a run;
 *   default every non-secret input.
 */
export type AppHooks = {
  options?: (context: AppContext) => Record<string, Option[]>;
  summary?: string[];
};
