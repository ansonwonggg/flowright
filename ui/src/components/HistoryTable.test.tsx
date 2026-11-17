import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowRun } from '../api.ts';
import { run } from '../lib/fixtures.test-utils.ts';
import { historyRows } from '../lib/historyRows.ts';
import { HistoryTable } from './HistoryTable.tsx';

const A = '20261105-120000-aaaa';
const B = '20261105-120100-bbbb';
const FLOW_ID = '20261105-115959-ffff';

const flow = (over: Partial<FlowRun> = {}): FlowRun => ({
  id: FLOW_ID,
  name: 'New ER user',
  env: 'dev',
  startedAt: 1_000,
  endedAt: 61_000,
  status: 'failed',
  values: {},
  steps: [
    { function: 'create-user', title: '[Web] Create ER User', status: 'passed', runId: A },
    { function: 'vet-datamod', title: '[Admin] Vet', status: 'failed', runId: B, error: 'Timed out', tries: [{ status: 'failed' }] },
    { function: 'activate-api', title: '[API] Activate', status: 'waiting' },
  ],
  ...over,
});

const runs = [run({ id: B, title: '[Admin] Vet', status: 'failed', records: [] }), run({ id: A, title: '[Web] Create ER User' })];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const show = (f: FlowRun = flow()) => {
  const onOpenRun = vi.fn();
  const onOpenFlow = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HistoryTable rows={historyRows(runs, [f])} onOpenRun={onOpenRun} onOpenFlow={onOpenFlow} />
    </QueryClientProvider>,
  );
  return { onOpenRun, onOpenFlow };
};

afterEach(() => vi.unstubAllGlobals());

describe('HistoryTable flow rows', () => {
  it('a flow is one row with its name, env, steps passed and the step that failed; its steps stay hidden', () => {
    show();
    const row = screen.getByRole('row', { name: /New ER user/ });
    expect(row).toHaveTextContent('flow');
    expect(row).toHaveTextContent('dev');
    expect(row).toHaveTextContent('1/3 steps passed');
    expect(row).toHaveTextContent('✗ Step 2 [Admin] Vet: Timed out');
    expect(row).toHaveTextContent('1m00s');
    expect(row).toHaveTextContent('RGD1');
    expect(screen.queryByText('Step 1')).toBeNull();
  });

  it('clicking the flow row opens the flow run', async () => {
    const { onOpenFlow } = show();
    await userEvent.click(screen.getByRole('row', { name: /New ER user/ }));
    expect(onOpenFlow).toHaveBeenCalledWith(FLOW_ID);
  });

  it('▸ shows and hides the steps without opening the flow', async () => {
    const { onOpenFlow } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Show steps of New ER user' }));
    expect(onOpenFlow).not.toHaveBeenCalled();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 3')).toBeInTheDocument();
    expect(screen.getByText('try 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hide steps of New ER user' }));
    expect(screen.queryByText('Step 1')).toBeNull();
  });

  it('a step that ran opens its run with the flow id; a step that never ran opens nothing', async () => {
    const { onOpenRun } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Show steps of New ER user' }));
    await userEvent.click(screen.getByText('Step 2').closest('tr')!);
    expect(onOpenRun).toHaveBeenCalledWith(B, FLOW_ID);
    onOpenRun.mockClear();
    await userEvent.click(screen.getByText('Step 3').closest('tr')!);
    expect(onOpenRun).not.toHaveBeenCalled();
  });

  it('a failed flow has Retry in its row; it asks first, and opens the flow once the server accepts', async () => {
    const fetch = vi.fn(async () => json({ id: FLOW_ID }, 202));
    vi.stubGlobal('fetch', fetch);
    const { onOpenFlow } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Retry step 2' }));
    const dialog = screen.getByRole('dialog');
    expect(onOpenFlow).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(fetch).toHaveBeenCalledWith(`/api/flow-runs/${FLOW_ID}/retry`, expect.objectContaining({ method: 'POST' }));
    expect(onOpenFlow).toHaveBeenCalledWith(FLOW_ID);
  });

  it('cancelling the retry neither retries nor opens the flow', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { onOpenFlow } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Retry step 2' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(onOpenFlow).not.toHaveBeenCalled();
  });

  it('a refused retry says why and stays put', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Another run is going.' }, 409)));
    const { onOpenFlow } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Retry step 2' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Another run is going.')).toBeInTheDocument();
    expect(onOpenFlow).not.toHaveBeenCalled();
  });

  it('a passed or running flow has no Retry, and no failed-step line', () => {
    for (const status of ['passed', 'running'] as const) {
      const { unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <HistoryTable rows={historyRows(runs, [flow({ status, steps: flow().steps.map((s) => ({ ...s, status: 'passed', error: undefined })) })])} onOpenRun={() => {}} onOpenFlow={() => {}} />
        </QueryClientProvider>,
      );
      expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
      expect(screen.queryByText(/✗ Step/)).toBeNull();
      unmount();
    }
  });

  it('a flow still going has no duration', () => {
    show(flow({ status: 'running', endedAt: undefined }));
    expect(screen.getByRole('row', { name: /New ER user/ })).not.toHaveTextContent('1m00s');
  });
});
