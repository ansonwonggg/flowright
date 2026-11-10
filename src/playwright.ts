import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Project, ReporterDescription } from '@playwright/test';
import type { Manifest } from './discover.ts';
import { PLAYWRIGHT_ENV, ROOT_ENV } from './fn.ts';
import { HISTORY_DIR, newRunId, RUN_ID_ENV } from './history.ts';

let current: Manifest | undefined;

/**
 * The manifest `flowkitProjects` read, for a reporter or anything else in the same Playwright process;
 * read afresh from `root` when there is none.
 */
export const currentManifest = (root = process.env.FLOWKIT_ROOT || process.cwd()): Manifest => (current ??= readManifest(root));

const resolveFrom = (root: string, specifier: string) => createRequire(path.resolve(root, 'package.json')).resolve(specifier);
const cliPath = (root: string) => resolveFrom(root, '@ansonwonggg/flowright/cli');

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The manifest of `root`, built in a child process so that this one never caches the function files.
 * Finds the CLI through `@ansonwonggg/flowright/cli` from `root`, so it works whether Playwright loads this file
 * as an ES module or as CommonJS.
 */
export const readManifest = (root: string): Manifest => {
  const env = { ...process.env, [PLAYWRIGHT_ENV]: '' };
  return JSON.parse(execFileSync(process.execPath, ['--no-warnings', cliPath(root), 'manifest', root], { env, encoding: 'utf8' }));
};

/**
 * One Playwright project per `*.fn.ts` under `root`, named by the function id, with its `setup`
 * projects as dependencies and its `use` and `timeout`. Spread them into `projects` next to the setup
 * projects, with `testDir` at `root`.
 *
 * Side effects: sets `FLOWKIT_PLAYWRIGHT=1`, so the function files register their tests when Playwright
 * loads them, and `FLOWKIT_ROOT` to `root`, so records land in the same place however Playwright is started.
 *
 * @throws when a function or step file breaks the pattern; the message lists every problem. Flow file
 *   problems don't stop Playwright; `flowright check` reports them.
 */
export const flowkitProjects = (root: string): Project[] => {
  const manifest = readManifest(root);
  current = manifest;
  const blocking = manifest.problems.filter((p) => p.layer !== 'flow');
  if (blocking.length) throw new Error(`flowkit: fix these before running:\n${blocking.map((p) => `- ${p.file}: ${p.message}`).join('\n')}`);
  process.env[PLAYWRIGHT_ENV] = '1';
  process.env[ROOT_ENV] = path.resolve(root);
  return manifest.functions.map((f) => ({
    name: f.id,
    testMatch: new RegExp(`${escape(path.sep + f.file)}$`),
    ...(f.setup.length && { dependencies: f.setup }),
    ...(f.use && { use: f.use }),
    ...(f.timeout && { timeout: f.timeout }),
  }));
};

const loadedAsCommonJs = typeof require === 'function';

const reporterPath = (root: string) => {
  const commonJs = resolveFrom(root, '@ansonwonggg/flowright/reporter');
  return loadedAsCommonJs ? commonJs : commonJs.replace(/\.c([jt])s$/, '.$1s');
};

/**
 * The reporters every flowkit repo uses: flowkit's own (terminal, history, app events) and Playwright's
 * HTML report, kept with the run in `out/runs/<id>/report/`. Put them in the config's `reporter`.
 *
 * Side effect: sets `FLOWKIT_RUN_ID` to a new run id when it isn't set yet, so the app can choose the id.
 */
export const flowkitReporters = (root: string): ReporterDescription[] => {
  const id = (process.env[RUN_ID_ENV] ??= newRunId());
  return [[reporterPath(root)], ['html', { open: 'never', outputFolder: path.join(path.resolve(root), HISTORY_DIR, id, 'report') }]];
};
