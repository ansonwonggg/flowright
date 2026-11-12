import { readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ENV_NAME_ENV, environmentEnv } from '../environments.ts';
import type { Fields } from '../fields.ts';
import type { FunctionMeta } from '../fn.ts';
import type { Values } from '../values.ts';

/** `env` with `<root>/.env.local` on top; just `env` when the file is missing or unreadable. */
export const localEnv = (root: string, env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> => {
  try {
    return { ...env, ...dotenv.parse(readFileSync(path.join(root, '.env.local'))) };
  } catch {
    return { ...env };
  }
};

const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * The env vars a run of `fn` with `values` needs and `env` lacks: the function's own `env`, plus what each
 * JSON input's field asks for through `env` (e.g. the login a user spec names). An entry `A|B` is met by
 * either; a set but empty var counts as missing.
 */
export const missingEnv = (fn: Pick<FunctionMeta, 'env' | 'inputs'>, values: Values, fields: Fields, env: Record<string, string | undefined>): string[] => {
  const fromValues = Object.keys(fn.inputs).flatMap((name) => {
    const f = fields[name];
    return f?.kind === 'json' && f.env && values[name] ? f.env(parse(values[name])) : [];
  });
  return [...fn.env, ...fromValues].filter((entry) => !entry.split('|').some((name) => Boolean(env[name])));
};

/** `env` without each of `names`, in any letter case: a proxy var is often set as both `HTTPS_PROXY` and `https_proxy`. */
export const withoutEnv = (env: NodeJS.ProcessEnv, names: string[]): NodeJS.ProcessEnv => {
  const drop = new Set(names.map((n) => n.toLowerCase()));
  return Object.fromEntries(Object.entries(env).filter(([key]) => !drop.has(key.toLowerCase())));
};

/**
 * The env a run started by the app gets: `env` without `unset` (any case), with environment `name`'s files
 * filled in under it and `FLOWKIT_ENV` set to `name`. With no `name`, `FLOWKIT_ENV` is dropped too, so a
 * value left in the app's own shell can't pick an environment the page didn't.
 */
export const runEnv = (root: string, name: string | undefined, env: NodeJS.ProcessEnv, unset: string[]): NodeJS.ProcessEnv => {
  const drop = [...unset, ENV_NAME_ENV];
  if (!name) return withoutEnv(env, drop);
  return { ...withoutEnv(environmentEnv(root, name, env), drop), [ENV_NAME_ENV]: name };
};
