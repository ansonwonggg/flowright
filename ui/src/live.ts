import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { FlowRun, RunInfo } from './api.ts';
import { appendLog, applyFlow, applyLive, invalidateEnvironment, keys } from './queries.ts';

/**
 * Subscribes to the server's event stream and keeps the React Query cache in step with it: the live run,
 * its log, flow runs as they move on, and a refresh of history, records and presets when a run ends or a
 * preset is saved, and of every env check when the environment changes.
 *
 * @returns whether the stream is connected, so the header can say when the server went away.
 */
export const useLiveEvents = (): boolean => {
  const client = useQueryClient();
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('live', (e) => applyLive(client, JSON.parse((e as MessageEvent).data) as RunInfo | null));
    source.addEventListener('log', (e) => {
      const { id, line } = JSON.parse((e as MessageEvent).data) as { id: string; line: string };
      appendLog(client, id, line);
    });
    source.addEventListener('finished', (e) => {
      const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
      for (const key of [keys.run(id), keys.history, keys.records, keys.meta, keys.live]) client.invalidateQueries({ queryKey: key });
    });
    source.addEventListener('flow', (e) => applyFlow(client, JSON.parse((e as MessageEvent).data) as FlowRun));
    source.addEventListener('changed', (e) => {
      if (JSON.parse((e as MessageEvent).data) === 'environment') return invalidateEnvironment(client);
      client.invalidateQueries({ queryKey: keys.presets });
      client.invalidateQueries({ queryKey: keys.meta });
    });
    return () => source.close();
  }, [client]);

  return connected;
};
