import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fieldJson, type FieldJson, type Fields } from './fields.ts';
import { flowProblems, secretProblems, type FlowDef } from './flow.ts';
import { isFunction, metaOf, type FunctionDef, type FunctionMeta } from './fn.ts';
import { DEFAULT_SETTINGS, type AppHooks, type KitSettings } from './settings.ts';
import { isStep } from './step.ts';

/** The file suffix of each layer. Discovery finds files by these alone. */
export const SUFFIX = { step: '.step.ts', function: '.fn.ts', flow: '.flow.json' } as const;

const SKIP = new Set(['node_modules', 'test-results', 'playwright-report']);

/** Files under `root` ending in `suffix`, absolute and sorted. Skips dot folders, `node_modules` and test output. */
export const findFiles = (root: string, suffix: string): string[] => {
  const walk = (dir: string): string[] => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      if (name.startsWith('.') || SKIP.has(name)) return [];
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return name.endsWith(suffix) ? [full] : [];
    });
  };
  return walk(path.resolve(root)).sort();
};

/** One thing that breaks the pattern, with the file it is in, relative to the root. */
export type Problem = { file: string; layer: 'step' | 'function' | 'flow'; message: string };

/** A loaded repo: its functions, steps and flows, the shared registry, and every problem found. */
export type Repo = {
  root: string;
  fields: Fields;
  settings: KitSettings;
  app: AppHooks;
  functions: { file: string; def: FunctionDef }[];
  steps: { file: string; names: string[] }[];
  flows: { file: string; flow?: FlowDef }[];
  problems: Problem[];
};

const load = async (file: string): Promise<Record<string, unknown>> => import(pathToFileURL(file).href);

const errorText = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

const loadFunctions = async (root: string, problems: Problem[]) => {
  const functions: Repo['functions'] = [];
  for (const full of findFiles(root, SUFFIX.function)) {
    const file = path.relative(root, full);
    const problem = (message: string) => problems.push({ file, layer: 'function', message });
    try {
      const def = (await load(full)).default;
      if (!isFunction(def)) {
        problem('the default export must come from defineFunction');
        continue;
      }
      const expected = path.basename(full, SUFFIX.function);
      if (def.id !== expected) problem(`id "${def.id}" must match the file name "${expected}"`);
      const twin = functions.find((f) => f.def.id === def.id);
      if (twin) problem(`id "${def.id}" is also used by ${twin.file}`);
      if (functions[0] && functions[0].def.fields !== def.fields) problem('uses a different field registry from the other functions; make one kit and share it');
      for (const name of [...Object.keys(def.inputs), ...def.outputs]) if (!def.fields[name]) problem(`"${name}" is not in the field registry`);
      if (def.record && !def.recordKey) problem(`record "${def.record}" isn't declared in the kit's records`);
      if (def.recordKey && def.starts && !def.outputs.includes(def.recordKey)) problem(`makes a new ${def.record} record, so it must output its key "${def.recordKey}"`);
      if (def.recordKey && !def.starts && !(def.recordKey in def.inputs)) problem(`works on a ${def.record} record, so it must take its key "${def.recordKey}" as an input`);
      functions.push({ file, def });
    } catch (e) {
      problem(`can't be loaded: ${errorText(e)}`);
    }
  }
  return functions.sort((a, b) => (a.def.order ?? Infinity) - (b.def.order ?? Infinity) || a.file.localeCompare(b.file));
};

const loadSteps = async (root: string, problems: Problem[]) => {
  const steps: Repo['steps'] = [];
  for (const full of findFiles(root, SUFFIX.step)) {
    const file = path.relative(root, full);
    try {
      const exports = Object.entries(await load(full));
      if (!exports.length) problems.push({ file, layer: 'step', message: 'exports nothing; a step file exports its steps' });
      for (const [name, value] of exports) if (!isStep(value)) problems.push({ file, layer: 'step', message: `export "${name}" is not a step; make it with defineStep, or move it out of the step file` });
      steps.push({ file, names: exports.map(([name]) => name) });
    } catch (e) {
      problems.push({ file, layer: 'step', message: `can't be loaded: ${errorText(e)}` });
    }
  }
  return steps;
};

const loadFlows = (root: string, metas: FunctionMeta[], fields: Fields, problems: Problem[]) =>
  findFiles(root, SUFFIX.flow).map((full) => {
    const file = path.relative(root, full);
    try {
      const flow = JSON.parse(readFileSync(full, 'utf8')) as FlowDef;
      const found = flowProblems(metas, fields, flow);
      for (const message of [...found, ...(found.length ? [] : secretProblems(fields, flow))]) problems.push({ file, layer: 'flow', message });
      return { file, flow };
    } catch (e) {
      problems.push({ file, layer: 'flow', message: `is not JSON: ${errorText(e)}` });
      return { file };
    }
  });

/**
 * Finds and loads every `*.step.ts`, `*.fn.ts` and `*.flow.json` under `root`, and checks the pattern:
 *
 * - a function file default-exports one `defineFunction`, with an id equal to its file name, unique,
 *   built from the one shared kit, using only registry names; a function on a record outputs its key
 *   when it starts the record, and takes it as an input otherwise;
 * - a step file exports only `defineStep` results;
 * - a flow file is JSON that {@link flowProblems} accepts and holds no secret.
 *
 * Imports the files, so call it outside Playwright: in that case `defineFunction` registers no tests.
 */
export const loadRepo = async (root: string): Promise<Repo> => {
  const problems: Problem[] = [];
  const functions = await loadFunctions(root, problems);
  const steps = await loadSteps(root, problems);
  const fields = functions[0]?.def.fields ?? {};
  const flows = loadFlows(root, functions.map((f) => metaOf(f.def)), fields, problems);
  const settings = functions[0]?.def.settings ?? DEFAULT_SETTINGS;
  return { root: path.resolve(root), fields, settings, app: functions[0]?.def.app ?? {}, functions, steps, flows, problems };
};

/** What the Playwright config and the app read: the repo as JSON, function files relative to the root. */
export type Manifest = {
  root: string;
  fields: FieldJson[];
  settings: KitSettings;
  functions: (FunctionMeta & { file: string })[];
  flows: { file: string; title?: string; flow?: FlowDef }[];
  problems: Problem[];
};

export const manifestOf = (repo: Repo): Manifest => ({
  root: repo.root,
  fields: Object.entries(repo.fields).map(([name, f]) => fieldJson(name, f)),
  settings: repo.settings,
  functions: repo.functions.map((f) => ({ ...metaOf(f.def), file: f.file })),
  flows: repo.flows.map((f) => ({ file: f.file, ...(f.flow?.title && { title: f.flow.title }), ...(f.flow && { flow: f.flow }) })),
  problems: repo.problems,
});
