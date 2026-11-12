import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowRun, RunInfo } from '../api.ts';
import { META, run as historyRun } from '../lib/fixtures.test-utils.ts';
import { FlowRunPage } from './FlowRunPage.tsx';
import { RunPage } from './RunPage.tsx';

const RUN_ID = '20261105-120000-aaaa';
const FLOW_ID = '20261105-110000-ffff';

const fnRun = (over: Partial<RunInfo> = {}): RunInfo =>
  ({ ...historyRun({ id: RUN_ID, input: { member_spec: '{"name":"Chan"}', mobile: '91234567' } }), view: { tests: [], failures: [] }, ...over }) as RunInfo;

const flowRun = (over: Partial<FlowRun> = {}): FlowRun => ({
  id: FLOW_ID,
  name: 'New ER user',
  startedAt: 0,
  endedAt: 90_000,
  status: 'passed',
  values: { reference_no: 'DMD1' },
  steps: [
    { function: 'create-user', title: '[Web] Create ER User', status: 'passed', values: { user_spec: { company: 'Acme' } }, input: { user_spec: '{"company":"Acme"}' }, output: { reference_no: 'DMD1' }, runId: RUN_ID },
    { function: 'vet-datamod', title: '[Admin] Vet', status: 'passed', input: { reference_no: 'DMD1' }, output: { status: 'SUCCEED' }, runId: RUN_ID },
  ],
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Server = { run?: RunInfo; flow?: FlowRun };

const serve = ({ run = fnRun(), flow = flowRun() }: Server) => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/meta') return json(META);
    if (path === '/api/records') return json([]);
    if (path === '/api/run/stop' && init?.method === 'POST') return json({ id: run.id });
    if (path.startsWith('/api/runs/')) return json({ run, log: ['line 1'] });
    if (path.startsWith('/api/flow-runs/')) return json(flow);
    return json({ error: `unexpected ${path}` }, 404);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

const stopCalls = (fetch: ReturnType<typeof serve>) => fetch.mock.calls.filter(([url]) => url === '/api/run/stop');

const at = (entry: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/run/:id" element={<RunPage />} />
          <Route path="/flow-run/:id" element={<FlowRunPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('RunPage', () => {
  it('links back to History and shows the status', async () => {
    serve({});
    at(`/run/${RUN_ID}`);
    expect(await screen.findByTestId('run-status')).toHaveTextContent('passed');
    expect(screen.getByRole('link', { name: '← History' })).toHaveAttribute('href', '/history');
  });

  it('a finished run can run again, prefilled from this run', async () => {
    serve({});
    at(`/run/${RUN_ID}`);
    expect(await screen.findByRole('link', { name: 'Run again' })).toHaveAttribute('href', `/fn/member-register?run=${RUN_ID}`);
  });

  it('a live run has Stop and no Run again', async () => {
    serve({ run: fnRun({ status: 'running', live: true, endedAt: undefined }) });
    at(`/run/${RUN_ID}`);
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Run again' })).toBeNull();
  });

  it('a finished run has no Stop', async () => {
    serve({});
    at(`/run/${RUN_ID}`);
    await screen.findByTestId('run-status');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('Stop asks first; Cancel leaves the run going', async () => {
    const fetch = serve({ run: fnRun({ status: 'running', live: true, endedAt: undefined }) });
    at(`/run/${RUN_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Whatever the system under test already accepted stays there.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(stopCalls(fetch)).toHaveLength(0);
  });

  it('shows the environment the run used, and names it in the Stop question', async () => {
    serve({ run: fnRun({ status: 'running', live: true, endedAt: undefined, env: 'uat' }) });
    at(`/run/${RUN_ID}`);
    expect(await screen.findByTitle('Environment')).toHaveTextContent('uat');
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Whatever the uat environment already accepted stays there.');
  });

  it('a run with no environment shows no environment chip', async () => {
    serve({});
    at(`/run/${RUN_ID}`);
    await screen.findByTestId('run-status');
    expect(screen.queryByTitle('Environment')).toBeNull();
  });

  it('a flow run shows the environment it ran in', async () => {
    serve({ flow: flowRun({ env: 'uat' }) });
    at(`/flow-run/${FLOW_ID}`);
    expect(await screen.findByTitle('Environment')).toHaveTextContent('uat');
  });

  it('Stop, confirmed, stops the run', async () => {
    const fetch = serve({ run: fnRun({ status: 'running', live: true, endedAt: undefined }) });
    at(`/run/${RUN_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    expect(stopCalls(fetch)).toHaveLength(1);
  });

  it('links to the kept Playwright report in a new tab; none when not kept', async () => {
    serve({});
    const { unmount } = at(`/run/${RUN_ID}`);
    const report = await screen.findByRole('link', { name: /report ↗/i });
    expect(report).toHaveAttribute('href', `/runs/${RUN_ID}/report/`);
    expect(report).toHaveAttribute('target', '_blank');
    unmount();
    serve({ run: fnRun({ hasReport: false }) });
    at(`/run/${RUN_ID}`);
    await screen.findByTestId('run-status');
    expect(screen.queryByRole('link', { name: /report ↗/i })).toBeNull();
  });

  it('the report link reads the same as on a flow step', async () => {
    serve({});
    at(`/run/${RUN_ID}`);
    expect(await screen.findByRole('link', { name: 'Report ↗' })).toHaveAttribute('title', 'Playwright report: screenshots, trace, errors');
  });

  it('opened from a flow step, it links back to that flow run by name', async () => {
    serve({});
    at(`/run/${RUN_ID}?flow=${FLOW_ID}`);
    expect(await screen.findByRole('link', { name: '← New ER user' })).toHaveAttribute('href', `/flow-run/${FLOW_ID}`);
    expect(screen.queryByRole('link', { name: '← History' })).toBeNull();
  });

  it('opened from a flow step whose flow run is gone, it still links back', async () => {
    const fetch = serve({});
    fetch.mockImplementation(async (url: string) =>
      String(url).startsWith('/api/flow-runs/') ? json({ error: 'No such flow run.' }, 404) : String(url) === '/api/meta' ? json(META) : String(url) === '/api/records' ? json([]) : json({ run: fnRun(), log: [] }),
    );
    at(`/run/${RUN_ID}?flow=${FLOW_ID}`);
    expect(await screen.findByRole('link', { name: '← Flow run' })).toHaveAttribute('href', `/flow-run/${FLOW_ID}`);
  });

  it('each input can be copied', async () => {
    serve({});
    at(`/run/${RUN_ID}`);
    const params = await screen.findByText('Parameters');
    await userEvent.click(params);
    expect(within(params.closest('details')!).getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  it('lists the inputs by field label, JSON laid out, and the browser', async () => {
    serve({});
    at(`/run/${RUN_ID}`);
    const params = await screen.findByText('Parameters');
    await userEvent.click(params);
    const fold = params.closest('details')!;
    expect(within(fold).getByText('Mobile')).toBeInTheDocument();
    expect(within(fold).getByText('91234567')).toBeInTheDocument();
    expect(within(fold).getByText(/"name": "Chan"/)).toBeInTheDocument();
    expect(within(fold).getByText('headless')).toBeInTheDocument();
  });
});

describe('FlowRunPage', () => {
  it('links back to Flows and shows the status', async () => {
    serve({});
    at(`/flow-run/${FLOW_ID}`);
    expect(await screen.findByTestId('flow-status')).toHaveTextContent('passed');
    expect(screen.getByRole('link', { name: '← Flows' })).toHaveAttribute('href', '/flows');
  });

  it('a running flow has Stop; a finished one does not', async () => {
    serve({ flow: flowRun({ status: 'running', endedAt: undefined }) });
    const { unmount } = at(`/flow-run/${FLOW_ID}`);
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    unmount();
    serve({});
    at(`/flow-run/${FLOW_ID}`);
    await screen.findByTestId('flow-status');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('Stop asks first, as on a function run; Cancel leaves the flow going', async () => {
    const fetch = serve({ flow: flowRun({ status: 'running', endedAt: undefined }) });
    at(`/flow-run/${FLOW_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Whatever the system under test already accepted stays there.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(stopCalls(fetch)).toHaveLength(0);
  });

  it('Stop, confirmed, stops the flow', async () => {
    const fetch = serve({ flow: flowRun({ status: 'running', endedAt: undefined }) });
    at(`/flow-run/${FLOW_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    expect(stopCalls(fetch)).toHaveLength(1);
  });

  it('a finished flow can run again from the builder; a running one cannot', async () => {
    serve({ flow: flowRun({ status: 'failed' }) });
    const { unmount } = at(`/flow-run/${FLOW_ID}`);
    expect(await screen.findByRole('link', { name: 'Run again' })).toHaveAttribute('href', `/flow-builder?run=${FLOW_ID}`);
    unmount();
    serve({ flow: flowRun({ status: 'running', endedAt: undefined }) });
    at(`/flow-run/${FLOW_ID}`);
    await screen.findByTestId('flow-status');
    expect(screen.queryByRole('link', { name: 'Run again' })).toBeNull();
  });

  it('a stopped flow shows the same pill a stopped function run does', async () => {
    serve({ flow: flowRun({ status: 'stopped' }) });
    at(`/flow-run/${FLOW_ID}`);
    expect(await screen.findByTestId('flow-status')).toHaveClass('pill', 'interrupted');
  });

  it('lists the values passed along', async () => {
    serve({});
    at(`/flow-run/${FLOW_ID}`);
    const fold = (await screen.findByText('Values passed along')).closest('details')!;
    expect(within(fold).getByLabelText('Values passed along')).toHaveTextContent('reference_noDMD1');
  });
});
