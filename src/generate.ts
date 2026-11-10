import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Need } from './contract.ts';
import type { Fields } from './fields.ts';
import { comesFromEarlier, flowProblems, type FlowDef } from './flow.ts';
import type { FunctionMeta } from './fn.ts';

/** The file every repo keeps at its root: exports `fields`, `records`, `defineFunction` and `defineStep`. */
export const KIT_FILE = 'kit.ts';

const KEBAB = /^[a-z][a-z0-9-]*$/;
const AREA = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/;

const camel = (kebab: string) => kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const sentence = (kebab: string) => kebab.charAt(0).toUpperCase() + kebab.slice(1).replace(/-/g, ' ');
const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
};

/** The closest of `known` to `name`, when it is close enough to be a typo. */
export const suggest = (name: string, known: string[]): string | undefined => {
  const best = known.map((k) => [k, distance(name, k)] as const).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(2, Math.floor(name.length / 3)) ? best[0] : undefined;
};

/** `"a, b"` → `['a', 'b']`; blank entries are dropped. */
export const parseList = (list: string | undefined): string[] =>
  (list ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Inputs from two comma lists. A name in both is optional. */
export const parseInputs = (required: string | undefined, optional: string | undefined): Record<string, Need> => ({
  ...Object.fromEntries(parseList(required).map((n) => [n, 'required' as const])),
  ...Object.fromEntries(parseList(optional).map((n) => [n, 'optional' as const])),
});

/** Every name not in the registry, with a "did you mean" when one is close. */
export const unknownNames = (names: string[], fields: Fields): string[] =>
  names
    .filter((n) => !fields[n])
    .map((n) => {
      const close = suggest(n, Object.keys(fields));
      return `"${n}" is not in the field registry${close ? `; did you mean "${close}"?` : ''}`;
    });

/** Source of a new step file: one step, named after the file, that fails until it is built. */
export const stepSource = (o: { name: string; portal: string; kit: string }): string => `import type { Page } from '@playwright/test';
import { defineStep } from ${quote(o.kit)};

export const ${camel(o.name)} = defineStep<{ page: Page }>({
  name: ${quote(sentence(o.name))},
  portal: ${quote(o.portal)},
  run: async ({ page }) => {
    void page;
    throw new Error(${quote(`${o.name}: not built yet`)});
  },
});
`;

/** Source of a new function file. Its `run` fails until it is built. */
export const functionSource = (o: {
  id: string;
  title: string;
  kit: string;
  record?: string;
  starts?: boolean;
  inputs: Record<string, Need>;
  outputs: string[];
}): string => {
  const inputs = Object.entries(o.inputs)
    .map(([name, need]) => `${name}: ${quote(need)}`)
    .join(', ');
  return `import { defineFunction } from ${quote(o.kit)};

export default defineFunction({
  id: ${quote(o.id)},
  title: ${quote(o.title)},
${o.record ? `  record: ${quote(o.record)},\n` : ''}${o.starts ? '  starts: true,\n' : ''}  inputs: { ${inputs} },
  outputs: [${o.outputs.map(quote).join(', ')}],
  run: async ({ page }, input) => {
    void page;
    void input;
    throw new Error(${quote(`${o.id}: not built yet`)});
  },
});
`;
};

/**
 * A new flow over `functions`: each required input that no earlier step gives, and the record can't
 * fill, gets an empty value to fill in (`{}` for a JSON field). The record key of a first step that
 * doesn't start a record is one of these.
 */
export const flowSource = (o: { title: string; functions: string[]; fns: FunctionMeta[]; fields: Fields }): FlowDef => {
  const steps = o.functions.map((id) => ({ function: id }));
  return {
    title: o.title,
    steps: steps.map((step, i) => {
      const fn = o.fns.find((f) => f.id === step.function);
      const given = comesFromEarlier(o.fns, steps, i);
      const blanks = Object.entries(fn?.inputs ?? {})
        .filter(([name, need]) => need === 'required' && !given(name))
        .map(([name]) => [name, o.fields[name]?.kind === 'json' ? {} : ''] as const);
      return blanks.length ? { ...step, values: Object.fromEntries(blanks) } : step;
    }),
  };
};

/** The import specifier of `target` from `fromFile`, e.g. `../../kit.ts`. */
export const importPath = (fromFile: string, target: string): string => {
  const rel = path.relative(path.dirname(fromFile), target).split(path.sep).join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
};

type Kit = { fields: Fields; records: Record<string, string> };

const loadKit = async (root: string): Promise<Kit> => {
  const file = path.join(root, KIT_FILE);
  if (!existsSync(file)) throw new Error(`${KIT_FILE} not found in ${root}: every repo keeps its kit there`);
  const kit = (await import(pathToFileURL(file).href)) as Partial<Kit>;
  if (!kit.fields) throw new Error(`${KIT_FILE} must export "fields"`);
  return { fields: kit.fields, records: kit.records ?? {} };
};

const write = (file: string, body: string) => {
  if (existsSync(file)) throw new Error(`${file} already exists; pick another name`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

/** What a generator wrote, and what is left to do. */
export type Generated = { file: string; next: string[] };

/**
 * Writes a new step file at `<root>/<area>/steps/<name>.step.ts`.
 *
 * @throws when the names aren't kebab-case or the file exists.
 */
export const newStep = (root: string, target: string, portal = 'web'): Generated => {
  const area = path.dirname(target);
  const name = path.basename(target);
  if (!AREA.test(area) || !KEBAB.test(name)) throw new Error(`"${target}" must look like <area>/<name>, kebab-case, e.g. er-user/verify-identity`);
  const file = path.join(root, area, 'steps', `${name}.step.ts`);
  if (!existsSync(path.join(root, KIT_FILE))) throw new Error(`${KIT_FILE} not found in ${root}: every repo keeps its kit there`);
  write(file, stepSource({ name, portal, kit: importPath(file, path.join(root, KIT_FILE)) }));
  return { file, next: [`fill in run in ${path.relative(root, file)}`, `call ${camel(name)}({ page }, …) from a function's run`] };
};

/**
 * Writes a new function file at `<root>/<area>/<id>.fn.ts`. A function on a record gets its key added:
 * as an output when it starts the record, as a required input otherwise.
 *
 * @throws listing every problem: bad id or area, no title, unknown names (with suggestions), unknown
 *   record kind, or an existing file.
 */
export const newFunction = async (
  root: string,
  target: string,
  o: { title?: string; record?: string; starts?: boolean; inputs?: string; optional?: string; outputs?: string },
): Promise<Generated> => {
  const kit = await loadKit(root);
  const area = path.dirname(target);
  const id = path.basename(target);
  const inputs = parseInputs(o.inputs, o.optional);
  const outputs = parseList(o.outputs);
  const key = o.record ? kit.records[o.record] : undefined;
  const problems = [
    ...(!AREA.test(area) || !KEBAB.test(id) ? [`"${target}" must look like <area>/<id>, kebab-case, e.g. er-user/activate-er-user-api`] : []),
    ...(!o.title?.trim() ? ['--title is required, e.g. "[API] Activate ER User Account"'] : []),
    ...(o.record && !key ? [`record "${o.record}" isn't in the kit; known: ${Object.keys(kit.records).join(', ') || 'none'}`] : []),
    ...(o.starts && !o.record ? ['--starts needs --record: a starting function makes a new record'] : []),
    ...unknownNames([...Object.keys(inputs), ...outputs], kit.fields),
  ];
  if (problems.length) throw new Error(`can't create ${target}:\n- ${problems.join('\n- ')}`);
  if (key && o.starts && !outputs.includes(key)) outputs.unshift(key);
  const file = path.join(root, area, `${id}.fn.ts`);
  write(file, functionSource({ id, title: o.title!.trim(), kit: importPath(file, path.join(root, KIT_FILE)), record: o.record, starts: o.starts, inputs: key && !o.starts ? { [key]: 'required', ...inputs } : inputs, outputs }));
  return { file, next: [`build its steps (flowkit new step ${area}/<name>)`, `fill in run in ${path.relative(root, file)}`] };
};

/**
 * Writes a new flow at `<root>/config/flows/<name>.flow.json`, with blanks for the values it still needs.
 *
 * @throws when the name isn't kebab-case, a function is unknown (with suggestions), or the file exists.
 */
export const newFlow = (root: string, name: string, functions: string[], known: { fns: FunctionMeta[]; fields: Fields }): Generated => {
  const ids = known.fns.map((f) => f.id);
  const problems = [
    ...(!KEBAB.test(name) ? [`"${name}" must be kebab-case, e.g. new-er-user`] : []),
    ...(!functions.length ? ['name at least one function'] : []),
    ...functions
      .filter((f) => !ids.includes(f))
      .map((f) => {
        const close = suggest(f, ids);
        return `unknown function "${f}"${close ? `; did you mean "${close}"?` : ''}`;
      }),
  ];
  if (problems.length) throw new Error(`can't create flow ${name}:\n- ${problems.join('\n- ')}`);
  const flow = flowSource({ title: sentence(name), functions, ...known });
  const file = path.join(root, 'config/flows', `${name}.flow.json`);
  write(file, `${JSON.stringify(flow, null, 2)}\n`);
  return { file, next: flowProblems(known.fns, known.fields, flow).map((p) => `fill in: ${p}`) };
};
