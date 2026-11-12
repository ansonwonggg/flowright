import type { FieldJson, FlowDef, FlowRun, FunctionMeta } from '../../src/index.ts';
import type { Option } from '../../src/forms/types.ts';
import type { FlowEvent, KitSettings, RunRecord } from '../../src/index.ts';

export type { FieldJson, FlowDef, FlowRun, FlowRunStep, FlowStep } from '../../src/index.ts';

/** A function as the server lists it: its contract, plus the file it lives in. */
export type Fn = FunctionMeta & { file: string };

export type Meta = { functions: Fn[]; fields: FieldJson[]; settings: KitSettings; options: Record<string, Option[]> };

/** A saved value or flow. `modifiedAt` (ms since epoch) is when its file last changed; sent for flows only. */
export type Preset = { file: string; label: string; summary: string; spec: unknown; modifiedAt?: number };

/** Saved values: of each JSON field with a presets folder, by field name, and saved flows. */
export type Presets = { fields: Record<string, Preset[]>; flows: Preset[] };

export type RecordRow = {
  kind: string;
  key: string;
  stage: string;
  stageLabel: string;
  summary: string;
  updatedAt: string;
  values: Record<string, string>;
  details: [string, string][];
  history: string[];
  /** Functions that take this kind of record by its key; see `functionsOn`. */
  functions: { id: string; title: string }[];
};

export type ShownStatus = RunRecord['status'] | 'stopping';

export type Failure = Extract<FlowEvent, { type: 'failure' }>;

export type RunInfo = Omit<RunRecord, 'status'> & { status: ShownStatus; summary: string; hasReport: boolean; live: boolean };

export type RunDetail = { run: RunInfo; log: string[] };

export type HistoryItem = Omit<RunInfo, 'view'> & { view: { failures: Failure[] } };

/** What the server says about a function's inputs before a run. */
export type InputCheck = { problems: string[]; fromRecord: string[]; unknownRecord: boolean; missingEnv: string[] };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`, res.status, body ?? {});
  return body as T;
};

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  meta: () => request<Meta>('/api/meta'),
  presets: () => request<Presets>('/api/presets'),
  records: () => request<RecordRow[]>('/api/records'),
  history: () => request<HistoryItem[]>('/api/history'),
  live: () => request<RunInfo | null>('/api/live'),
  run: (id: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  check: (fn: string, values: Record<string, unknown>) => post<InputCheck>('/api/check', { function: fn, values }),
  start: (body: { function: string; values: Record<string, unknown>; headed: boolean }) => post<{ id: string }>('/api/run', body),
  stop: () => post<{ id: string }>('/api/run/stop', {}),
  savePreset: (body: { field: string; name: string; value: unknown; overwrite: boolean }) => post<{ file: string }>('/api/presets', body),
  checkFlow: (flow: FlowDef) => post<{ errors: string[]; warnings: string[] }>('/api/flow/check', { flow }),
  startFlow: (body: { name: string; flow: FlowDef; headed: boolean; file?: string }) => post<{ id: string }>('/api/flow/run', body),
  saveFlow: (body: { name: string; flow: FlowDef; overwrite: boolean }) => post<{ file: string }>('/api/flows', body),
  flowRuns: () => request<FlowRun[]>('/api/flow-runs'),
  flowRun: (id: string) => request<FlowRun>(`/api/flow-runs/${encodeURIComponent(id)}`),
};
