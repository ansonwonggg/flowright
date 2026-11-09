import type { PlaywrightTestOptions, TestInfo, TestType } from '@playwright/test';
import path from 'node:path';
import { checkOutput, masked, prepareInput, type Need } from './contract.ts';
import type { Fields, ValueOf } from './fields.ts';
import { readInput, writeOutput } from './io.ts';
import { fillFromRecord, readRecord, RECORDS_DIR, saveRecord } from './records.ts';
import { DEFAULT_SETTINGS, type AppHooks, type KitSettings, type RecordKind } from './settings.ts';
import { stepMaker } from './step.ts';

type AnyTest = TestType<any, any>;
type FixturesOf<T> = T extends TestType<infer A, infer W> ? A & W : never;
type RequiredKeys<I> = { [K in keyof I]: I[K] extends 'required' ? K : never }[keyof I];

/** What `run` gets as input: required names are always there, optional ones may be missing; JSON fields come parsed. */
export type InputOf<I, F extends Fields = Fields> = { [K in RequiredKeys<I> & string]: ValueOf<F[K]> } & { [K in Exclude<keyof I, RequiredKeys<I>> & string]?: ValueOf<F[K]> };

/** What `run` may return: any of the declared output names, a JSON field as its object. */
export type OutputOf<O extends readonly string[], F extends Fields = Fields> = { [K in O[number]]?: ValueOf<F[K]> };

/** Env var the Playwright config sets so that loading a `*.fn.ts` file registers its test. */
export const PLAYWRIGHT_ENV = 'FLOWKIT_PLAYWRIGHT';
/** Env var holding the repo root, set by the Playwright config and the CLI; relative paths resolve from it. */
export const ROOT_ENV = 'FLOWKIT_ROOT';

/** `dir` resolved from the repo root ({@link ROOT_ENV}), else from the working directory. */
export const fromRoot = (dir: string): string => path.resolve(process.env[ROOT_ENV] || process.cwd(), dir);

/** A function as data: what discovery, the app and the flow runner read. JSON-safe. */
export type FunctionMeta = {
  id: string;
  title: string;
  detail: string;
  order?: number;
  record?: string;
  recordKey?: string;
  starts: boolean;
  inputs: Record<string, Need>;
  outputs: string[];
  env: string[];
  setup: string[];
  timeout?: number;
  use?: Partial<PlaywrightTestOptions>;
};

const FN = Symbol.for('flowkit.function');

/** What a `*.fn.ts` file default-exports. */
export type FunctionDef = FunctionMeta & {
  readonly [FN]: true;
  fields: Fields;
  recordsDir: string;
  settings: KitSettings;
  app: AppHooks;
  test: AnyTest;
  run: (fixtures: object, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

/** True for what `defineFunction` returns. */
export const isFunction = (value: unknown): value is FunctionDef => Boolean(value && typeof value === 'object' && FN in value);

/** The JSON-safe part of a function. */
export const metaOf = (fn: FunctionDef): FunctionMeta => ({
  id: fn.id,
  title: fn.title,
  detail: fn.detail,
  ...(fn.order !== undefined && { order: fn.order }),
  ...(fn.record && { record: fn.record }),
  ...(fn.recordKey && { recordKey: fn.recordKey }),
  starts: fn.starts,
  inputs: fn.inputs,
  outputs: fn.outputs,
  env: fn.env,
  setup: fn.setup,
  ...(fn.timeout && { timeout: fn.timeout }),
  ...(fn.use && { use: fn.use }),
});

const ID = /^[a-z][a-z0-9-]*$/;

const register = (fn: FunctionDef) => {
  const body = async (fixtures: object, testInfo: TestInfo) => {
    if (fn.timeout) testInfo.setTimeout(fn.timeout);
    const given = readInput();
    const dir = fromRoot(fn.recordsDir);
    const raw = fn.record && fn.recordKey ? fillFromRecord(fn.inputs, given, readRecord(dir, fn.record, given[fn.recordKey])) : given;
    const input = prepareInput(fn, raw);
    await testInfo.attach('inputs', { body: JSON.stringify(masked(fn.fields, input), null, 2), contentType: 'application/json' });
    const output = checkOutput(fn, await fn.run(fixtures, input));
    writeOutput(output);
    await testInfo.attach('outputs', { body: JSON.stringify(masked(fn.fields, output), null, 2), contentType: 'application/json' });
    const key = fn.recordKey && (output[fn.recordKey] ?? raw[fn.recordKey]);
    if (fn.record && key) saveRecord(dir, { kind: fn.record, key, fn: fn.id, output, now: new Date() });
  };
  body.toString = () => fn.run.toString();
  fn.test(fn.title, body);
};

/**
 * Binds the kit to a repo's field registry, so every input and output name is checked by TypeScript.
 *
 * - `test`: the repo's Playwright `test` (from `@playwright/test`, or one extended with its fixtures). The
 *   kit's `defineStep` and `defineFunction` run under it.
 *
 * - `records`: each record kind and the field that keys it, e.g. `{ 'er-user': 'reference_no' }`, or
 *   `{ key, label, summary }` to also say how the app and reporter show it (see {@link RecordKind}).
 *   Records are kept in `recordsDir` (default `out/records`, from the repo root).
 * - `title`, `command`, `unsetEnv`, `failures`: what the app and reporter show; see {@link KitSettings}.
 * - `app`: the kit's form lists and run summary for the app; see {@link AppHooks}.
 *
 * `defineFunction` declares one runnable function; put it as the default export of `<id>.fn.ts`.
 * - `inputs`: name → `required` | `optional`. `outputs`: the names `run` may return.
 * - `order`: where it sorts in lists, lowest first; functions without one come last, by file name.
 * - `record`: what kind of record it works on (e.g. `er-user`); a flow keeps to one kind. After the
 *   function passes, its outputs are saved to that record; before it starts, any input not given is
 *   taken from the record, found by its key input.
 * - `starts`: it makes a new record, so it can only be a flow's first function.
 * - `test`: a Playwright `test` with extra fixtures for this function; default the kit's.
 * - `setup`: Playwright projects to run first (e.g. a saved login). `use` / `timeout`: per-function settings.
 * - `env`: env vars it needs, so the app can warn before a run.
 * - `run`: destructure the fixtures in its first parameter, as in any Playwright test, e.g.
 *   `async ({ page }, input) => …`; Playwright reads the fixture names from it.
 *
 * Loading the file has no side effect, except under the flowkit Playwright config, which makes it
 * register the function's test. There the test reads its inputs (filling gaps from the record), checks
 * them, runs, checks the outputs, writes them and saves them to the record; a missing required input or
 * an undeclared output fails the test.
 */
export const createKit = <
  const F extends Fields,
  K extends AnyTest,
  const R extends Record<string, (keyof F & string) | { key: keyof F & string; label?: string; summary?: string[] }> = Record<never, never>,
>(
  fields: F,
  options: Partial<Omit<KitSettings, 'records'>> & { test: K; records?: R; recordsDir?: string; app?: AppHooks },
) => {
  type Name = keyof F & string;
  const records = (options.records ?? {}) as R;
  const recordsDir = options.recordsDir ?? RECORDS_DIR;
  const kinds = Object.fromEntries(
    Object.entries(records).map(([kind, r]): [string, RecordKind] => (typeof r === 'string' ? [kind, { key: r, label: kind, summary: [] }] : [kind, { key: r.key, label: r.label ?? kind, summary: r.summary ?? [] }])),
  );
  const settings: KitSettings = {
    title: options.title ?? DEFAULT_SETTINGS.title,
    records: kinds,
    command: options.command ?? DEFAULT_SETTINGS.command,
    unsetEnv: options.unsetEnv ?? [],
    failures: options.failures ?? [],
  };
  const app = options.app ?? {};
  const defineFunction = <const I extends { [N in Name]?: Need }, const O extends readonly Name[], T extends AnyTest = K>(spec: {
    id: string;
    title: string;
    detail?: string;
    order?: number;
    record?: keyof R & string;
    starts?: boolean;
    test?: T;
    setup?: string[];
    timeout?: number;
    use?: Partial<PlaywrightTestOptions>;
    env?: string[];
    inputs: I & Record<Exclude<keyof I, Name>, never>;
    outputs: O;
    run: (fixtures: FixturesOf<T>, input: InputOf<I, F>) => Promise<OutputOf<O, F>>;
  }): FunctionDef => {
    if (!ID.test(spec.id)) throw new Error(`function id "${spec.id}" must be kebab-case`);
    const fn: FunctionDef = {
      [FN]: true,
      id: spec.id,
      title: spec.title,
      detail: spec.detail ?? '',
      ...(spec.order !== undefined && { order: spec.order }),
      ...(spec.record && { record: spec.record, recordKey: kinds[spec.record]?.key }),
      starts: spec.starts ?? false,
      inputs: { ...spec.inputs } as Record<string, Need>,
      outputs: [...spec.outputs],
      env: spec.env ?? [],
      setup: spec.setup ?? [],
      ...(spec.timeout && { timeout: spec.timeout }),
      ...(spec.use && { use: spec.use }),
      fields,
      recordsDir,
      settings,
      app,
      test: spec.test ?? options.test,
      run: spec.run as unknown as FunctionDef['run'],
    };
    if (process.env[PLAYWRIGHT_ENV] === '1') register(fn);
    return fn;
  };
  return { fields, records, settings, defineFunction, defineStep: stepMaker(options.test) };
};
