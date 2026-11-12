import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Preset } from '../settings.ts';

const walk = (dir: string): string[] => {
  try {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : name.endsWith('.json') ? [full] : [];
    });
  } catch {
    return [];
  }
};

/**
 * Every `*.json` under `<root>/config/<folder>/`, subfolders included, sorted by path. `file` is relative to
 * `root`; `label` is the path inside the folder without `.json`, e.g. `cr089/g5`. A file that isn't JSON is
 * kept with `value: undefined`, so the app can say so. A missing folder gives `[]`.
 */
export const listPresets = (folder: string, root: string): Preset[] =>
  walk(path.join(root, 'config', folder))
    .sort()
    .map((full) => {
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        value = undefined;
      }
      const file = path.relative(root, full);
      return { file, label: path.relative(path.join('config', folder), file).replace(/\.json$/, ''), value };
    });

/** What a saved flow is called: its `title` when it has a non-blank one, else its path inside `config/flows/` without `.flow.json`. */
export const flowLabel = (file: string, spec: unknown): string => {
  const title = spec && typeof spec === 'object' && !Array.isArray(spec) ? (spec as { title?: unknown }).title : undefined;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return file.replace(/^config\/flows\//, '').replace(/\.flow\.json$/, '');
};

/**
 * `given` when it is exactly one of the saved flow `files` (from the repo root), else `undefined`. A page sends
 * the file a run came from; this keeps a run from claiming a flow that doesn't exist.
 */
export const savedFlowFile = (given: unknown, files: string[]): string | undefined => (typeof given === 'string' && files.includes(given) ? given : undefined);
