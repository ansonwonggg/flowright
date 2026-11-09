import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const newest = (target: string): number => {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...readdirSync(target).map((name) => newest(path.join(target, name))));
};

/** Whether `<uiRoot>/dist` is missing or older than any of `sources`, so the page must be built again. */
export const needsBuild = (uiRoot: string, sources: string[]): boolean => {
  const built = newest(path.join(uiRoot, 'dist', 'index.html'));
  return built === 0 || sources.some((source) => newest(source) > built);
};

/** Builds the page into `<uiRoot>/dist` with Vite, when {@link needsBuild} says so. */
export const buildUi = async (uiRoot: string, sources: string[]): Promise<void> => {
  if (!needsBuild(uiRoot, sources)) return;
  console.log('Building the app page…');
  const { build } = await import('vite');
  await build({ configFile: path.join(uiRoot, 'vite.config.mts'), logLevel: 'warn' });
};
