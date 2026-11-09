import { producedBefore, type FlowDef } from '../../../src/flow.ts';
import type { RecordKind } from '../../../src/settings.ts';
import type { Fn } from '../api.ts';

const TAG = /^\[([^\]]+)\]\s+(\S.*)$/;

/** A function title split into its leading `[tag]` (e.g. the portal) and the rest. No tag: `name` is the whole title. */
export const splitTag = (title: string): { tag?: string; name: string } => {
  const match = TAG.exec(title);
  return match ? { tag: match[1], name: match[2] } : { name: title };
};

/** A colour slot 0–5 for a tag, the same for the same tag in any case; `undefined` for no tag. */
export const toneOf = (tag: string | undefined): number | undefined => {
  if (!tag) return undefined;
  let hash = 0;
  for (const ch of tag.toLowerCase()) hash = (hash * 19 + ch.charCodeAt(0)) % 9973;
  return hash % 6;
};

/** The flow check's errors for step `index` (0-based), without their `Step n: ` prefix. */
export const stepErrors = (errors: string[], index: number): string[] => {
  const prefix = `Step ${index + 1}: `;
  return errors.filter((e) => e.startsWith(prefix)).map((e) => e.slice(prefix.length));
};

/** Inputs of step `index` that an earlier step gives and the step leaves blank: what flows into it. */
export const carried = (fns: Fn[], flow: FlowDef, index: number): string[] => {
  const step = flow.steps[index];
  const fn = fns.find((f) => f.id === step?.function);
  if (!fn || index === 0) return [];
  const produced = producedBefore(fns, flow.steps, index);
  const typed = step.values ?? {};
  return Object.keys(fn.inputs).filter((name) => produced.has(name) && typed[name] === undefined);
};

/** Every value the flow's functions give, once each, in the order first given. */
export const flowGives = (fns: Fn[], ids: string[]): string[] => [...new Set(ids.flatMap((id) => fns.find((f) => f.id === id)?.outputs ?? []))];

/** What a flow starts on, from its first function: "A new ER user", "An existing member", or "Start". */
export const startLabel = (fns: Fn[], ids: string[], records: Record<string, RecordKind>): string => {
  const first = fns.find((f) => f.id === ids[0]);
  if (!first?.record) return 'Start';
  const label = records[first.record]?.label ?? first.record;
  return first.starts ? `A new ${label}` : `An existing ${label}`;
};

/** Functions grouped by record kind: the kit's kinds in its order, then unlisted kinds, then "Other" for none. Empty groups are dropped. */
export const groupByRecord = (fns: Fn[], records: Record<string, RecordKind>): { label: string; fns: Fn[] }[] => {
  const kinds = [...new Set([...Object.keys(records), ...fns.flatMap((f) => (f.record ? [f.record] : []))])];
  return [
    ...kinds.map((kind) => ({ label: records[kind]?.label ?? kind, fns: fns.filter((f) => f.record === kind) })),
    { label: 'Other', fns: fns.filter((f) => !f.record) },
  ].filter((g) => g.fns.length > 0);
};

/** A title as a saved-flow file name: lower case, runs of anything but `a-z 0-9 . _ - /` as one dash, no dashes at the ends. */
export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .split('/')
    .map((part) => part.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/');

/** A saved flow's file name as the builder edits it: the path inside `config/flows/` without `.flow.json`. */
export const fileNameOf = (file: string | undefined): string => (file ?? '').replace(/^config\/flows\//, '').replace(/\.flow\.json$/, '');
