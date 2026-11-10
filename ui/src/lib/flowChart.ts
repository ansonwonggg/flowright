import { flatten, isIf, producedBefore, type FlowDef } from '../../../src/flow.ts';
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

/**
 * One step's check errors (as {@link stepErrors} gives them) split into the inputs left blank, by label, and
 * every other problem. The check words a blank input "<title> needs <label>", so `title` is the step's
 * function title; `undefined` (an IF, an unknown function) leaves everything in `other`.
 */
export const missingInputs = (problems: string[], title: string | undefined): { missing: string[]; other: string[] } => {
  const prefix = title === undefined ? undefined : `${title} needs `;
  const missing: string[] = [];
  const other: string[] = [];
  for (const p of problems) {
    if (prefix && p.startsWith(prefix)) missing.push(p.slice(prefix.length));
    else other.push(p);
  }
  return { missing, other };
};

const NAMED_INPUTS = 3;

/** Labels as "A, B, C and 2 more": at most three named. */
export const someOf = (labels: string[]): string =>
  labels.length > NAMED_INPUTS ? `${labels.slice(0, NAMED_INPUTS).join(', ')} and ${labels.length - NAMED_INPUTS} more` : labels.join(', ');

const STEP = /^Step (\d+): /;

/**
 * The flow check's errors with each step's blank inputs folded into one line, "Step 1: <title> needs 5
 * inputs: A, B, C and 2 more", at the place of the first. `titles[i]` is flat step i's title. A single
 * blank input, other errors, and lines with no step or past `titles` pass through unchanged, in order.
 */
export const foldMissing = (errors: string[], titles: string[]): string[] => {
  const missingOf = new Map<number, string[]>();
  const placed: (string | number)[] = [];
  for (const e of errors) {
    const n = Number(STEP.exec(e)?.[1]);
    const title = titles[n - 1];
    const label = title === undefined ? undefined : missingInputs([e.replace(STEP, '')], title).missing[0];
    if (label === undefined) {
      placed.push(e);
      continue;
    }
    if (!missingOf.has(n)) {
      missingOf.set(n, []);
      placed.push(n);
    }
    missingOf.get(n)?.push(label);
  }
  return placed.map((p) => {
    if (typeof p === 'string') return p;
    const labels = missingOf.get(p) ?? [];
    const head = `Step ${p}: ${titles[p - 1]} needs`;
    return labels.length === 1 ? `${head} ${labels[0]}` : `${head} ${labels.length} inputs: ${someOf(labels)}`;
  });
};

/** Inputs of step `index` (flat) that an earlier step gives and the step leaves blank: what flows into it. An IF takes none. */
export const carried = (fns: Fn[], flow: FlowDef, index: number): string[] => {
  const flat = flatten(flow);
  const step = flat[index];
  if (!step || isIf(step)) return [];
  const fn = fns.find((f) => f.id === step.function);
  if (!fn || index === 0) return [];
  const produced = producedBefore(fns, flat, index);
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
