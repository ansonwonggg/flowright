import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FlowDef, type FlowRun, type RunDetail, type RunInfo } from './api.ts';

export const keys = {
  meta: ['meta'],
  presets: ['presets'],
  records: ['records'],
  history: ['history'],
  live: ['live'],
  run: (id: string) => ['run', id],
  flowRuns: ['flow-runs'],
  flowRun: (id: string) => ['flow-run', id],
} as const;

export const useMeta = () => useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: 30_000 });
export const usePresets = () => useQuery({ queryKey: keys.presets, queryFn: api.presets });
export const useRecords = () => useQuery({ queryKey: keys.records, queryFn: api.records });
export const useHistory = () => useQuery({ queryKey: keys.history, queryFn: api.history });
export const useLive = () => useQuery({ queryKey: keys.live, queryFn: api.live, staleTime: Infinity });
export const useRun = (id: string) => useQuery({ queryKey: keys.run(id), queryFn: () => api.run(id), staleTime: Infinity, retry: false });

export const useFlowRuns = () => useQuery({ queryKey: keys.flowRuns, queryFn: api.flowRuns });
export const useFlowRun = (id: string) => useQuery({ queryKey: keys.flowRun(id), queryFn: () => api.flowRun(id), retry: false, enabled: Boolean(id) });

export const useFlowCheck = (flow: FlowDef) =>
  useQuery({ queryKey: ['check-flow', JSON.stringify(flow)], queryFn: () => api.checkFlow(flow), placeholderData: keepPreviousData });

export const useStartFlow = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.startFlow, onSuccess: () => client.invalidateQueries({ queryKey: keys.flowRuns }) });
};

export const useSaveFlow = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.saveFlow, onSuccess: () => client.invalidateQueries({ queryKey: keys.presets }) });
};

/** Puts a flow run the server announced into the cache, and refreshes the list of flow runs. */
export const applyFlow = (client: ReturnType<typeof useQueryClient>, run: FlowRun) => {
  client.setQueryData(keys.flowRun(run.id), run);
  client.invalidateQueries({ queryKey: keys.flowRuns });
};

export const useInputCheck = (fn: string, values: Record<string, unknown>) =>
  useQuery({ queryKey: ['check', fn, JSON.stringify(values)], queryFn: () => api.check(fn, values), placeholderData: keepPreviousData });

export const useStartRun = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.start, onSuccess: () => client.invalidateQueries({ queryKey: keys.live }) });
};

export const useStopRun = () => useMutation({ mutationFn: api.stop });

export const useSavePreset = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.savePreset, onSuccess: () => client.invalidateQueries({ queryKey: keys.presets }) });
};

/** Applies a live snapshot to the cache: the live run, and that run's detail page if it is cached. */
export const applyLive = (client: ReturnType<typeof useQueryClient>, live: RunInfo | null) => {
  client.setQueryData(keys.live, live);
  if (live) client.setQueryData<RunDetail>(keys.run(live.id), (old) => ({ run: live, log: old?.log ?? [] }));
};

/** Appends one log line to a cached run detail; does nothing when the run isn't cached. */
export const appendLog = (client: ReturnType<typeof useQueryClient>, id: string, line: string) =>
  client.setQueryData<RunDetail>(keys.run(id), (old) => (old ? { ...old, log: [...old.log, line] } : old));
