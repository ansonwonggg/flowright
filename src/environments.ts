import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/** Env var naming the environment a run uses: `.env.<name>.local` on top of `.env.local`. Empty or unset: `.env.local` alone. */
export const ENV_NAME_ENV = 'FLOWKIT_ENV';

/** The file every environment shares. */
export const SHARED_ENV_FILE = '.env.local';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FILE = /^\.env\.([A-Za-z0-9][A-Za-z0-9_-]*)\.local$/;

/** The file holding environment `name`, e.g. `.env.uat.local`. */
export const environmentFile = (name: string): string => `.env.${name}.local`;

/** The environments under `root`, one per `.env.<name>.local`, sorted. `[]` when there are none or `root` can't be read. */
export const listEnvironments = (root: string): string[] => {
  try {
    return readdirSync(root)
      .flatMap((file) => FILE.exec(file)?.[1] ?? [])
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

/** Why `name` can't be used as an environment under `root`, or `undefined` when its file is there. */
export const environmentProblem = (root: string, name: string): string | undefined => {
  if (!NAME.test(name)) return `"${name}" is not an environment name; use letters, digits, - and _.`;
  const all = listEnvironments(root);
  if (all.includes(name)) return undefined;
  const there = all.length ? `Environments here: ${all.join(', ')}.` : 'There are none yet; add a .env.<name>.local file.';
  return `No environment "${name}": ${environmentFile(name)} is missing. ${there}`;
};

const readFile = (root: string, file: string): Record<string, string> => {
  try {
    return dotenv.parse(readFileSync(path.join(root, file)));
  } catch {
    return {};
  }
};

/**
 * What a run under environment `name` sees: `.env.local`, then `.env.<name>.local` over it, then `env` over
 * both, as dotenv leaves a var that already exists (even when empty). Missing files read as empty.
 */
export const environmentEnv = (root: string, name: string | undefined, env: NodeJS.ProcessEnv): Record<string, string | undefined> => ({
  ...readFile(root, SHARED_ENV_FILE),
  ...(name ? readFile(root, environmentFile(name)) : {}),
  ...env,
});

const SECRET_WORDS = new Set(['PASSWORD', 'PASSWD', 'PWD', 'SECRET', 'KEY', 'TOKEN', 'CREDENTIAL', 'CREDENTIALS', 'PASSPHRASE']);

/**
 * Whether a var holds a secret, judged by the last `_`-separated word of its name in any case: `ER_PASSWORD`,
 * `API_KEY` and `ACCESS_TOKEN` are; `DDE_TOKEN_URL`, `PASSWORD_RULE_URL` and `KEYBOARD` are not.
 */
export const isSecretName = (name: string): boolean => SECRET_WORDS.has(name.toUpperCase().split('_').at(-1) ?? '');

/**
 * One var of an environment as the app shows it.
 *
 * - `value`: absent for a secret, so a secret never leaves the server.
 * - `set`: whether the value is non-empty.
 * - `from`: the file it comes from (`.env.local` or `.env.<name>.local`), or `shell` when the app's own
 *   env sets it, which then wins.
 */
export type EnvironmentVar = { name: string; value?: string; secret: boolean; set: boolean; from: string };

/**
 * Every var in `.env.local` and `.env.<name>.local`, sorted by name, with where its value comes from. A var
 * only in `env` is left out: the app's own env holds much that isn't the repo's.
 */
export const describeEnvironment = (root: string, name: string | undefined, env: NodeJS.ProcessEnv): EnvironmentVar[] => {
  const shared = readFile(root, SHARED_ENV_FILE);
  const own = name ? readFile(root, environmentFile(name)) : {};
  const names = [...new Set([...Object.keys(shared), ...Object.keys(own)])].sort((a, b) => a.localeCompare(b));
  return names.map((key) => {
    let from = name && key in own ? environmentFile(name) : SHARED_ENV_FILE;
    let value = key in own ? own[key] : shared[key];
    if (env[key] !== undefined) {
      from = 'shell';
      value = env[key];
    }
    const secret = isSecretName(key);
    return { name: key, ...(!secret && { value }), secret, set: Boolean(value), from };
  });
};

/**
 * Loads the environment `FLOWKIT_ENV` names into `env`, for a Playwright config started on its own (the app
 * and `flowright run` pass the vars down already). Sets only the vars `env` lacks, from
 * `.env.<name>.local` first, then `.env.local`. Call it where the config called `dotenv.config`.
 *
 * @returns the environment loaded; `undefined` when `FLOWKIT_ENV` is unset or empty (`.env.local` alone).
 * @throws when `FLOWKIT_ENV` names an environment with no file, before setting anything, so a run never
 *   falls back to another environment's hosts.
 */
export const loadEnvironment = (root: string, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const name = env[ENV_NAME_ENV] || undefined;
  const problem = name && environmentProblem(root, name);
  if (problem) throw new Error(problem);
  const merged = environmentEnv(root, name, env);
  for (const [key, value] of Object.entries(merged)) env[key] ??= value;
  return name;
};
