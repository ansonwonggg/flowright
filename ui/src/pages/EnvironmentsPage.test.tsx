import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environments, RunInfo } from '../api.ts';
import { EnvPicker } from '../components/EnvPicker.tsx';
import { EnvironmentsPage } from './EnvironmentsPage.tsx';

const ENVS: Environments = {
  active: 'uat',
  shared: { file: '.env.local', vars: [{ name: 'NEW_USER_PASSWORD', secret: true, set: true, from: '.env.local' }] },
  environments: [
    { name: 'dev', file: '.env.dev.local', vars: [{ name: 'PORTAL_URL', value: 'https://dev.example', secret: false, set: true, from: '.env.dev.local' }] },
    {
      name: 'uat',
      file: '.env.uat.local',
      vars: [
        { name: 'ER_PASSWORD', secret: true, set: false, from: '.env.uat.local' },
        { name: 'NEW_USER_PASSWORD', secret: true, set: true, from: '.env.local' },
        { name: 'PORTAL_URL', value: 'https://shell.example', secret: false, set: true, from: 'shell' },
        { name: 'WEB_API', value: '', secret: false, set: false, from: '.env.uat.local' },
      ],
    },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const serve = ({ envs = ENVS, live = null, choose = (name: string | null) => json({ active: name }) }: { envs?: Environments; live?: Partial<RunInfo> | null; choose?: (name: string | null) => Response }) => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/environments') return json(envs);
    if (url === '/api/live') return json(live);
    if (url === '/api/environments/active' && init?.method === 'POST') return choose(JSON.parse(String(init.body)).name);
    return json({ error: `unexpected ${url}` }, 404);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

const show = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}\\b`) });

afterEach(() => vi.unstubAllGlobals());

describe('EnvironmentsPage', () => {
  it('opens on the environment in use, one tab per environment plus .env.local alone', async () => {
    serve({});
    show(<EnvironmentsPage />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['dev', 'uat · in use', '.env.local only']);
    expect(screen.getByRole('tab', { name: /uat/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '.env.uat.local over .env.local' })).toBeInTheDocument();
  });

  it('shows values, never secrets: a set secret as •••• set, an empty var as empty, and where each comes from', async () => {
    serve({});
    show(<EnvironmentsPage />);
    await screen.findAllByRole('tab');
    expect(within(rowOf('NEW_USER_PASSWORD')).getByText('•••• set')).toBeInTheDocument();
    expect(within(rowOf('NEW_USER_PASSWORD')).getByText('.env.local')).toBeInTheDocument();
    expect(within(rowOf('ER_PASSWORD')).getByText('empty')).toHaveClass('warn');
    expect(within(rowOf('WEB_API')).getByText('empty')).toHaveClass('warn');
    expect(within(rowOf('PORTAL_URL')).getByText('https://shell.example')).toBeInTheDocument();
    expect(within(rowOf('PORTAL_URL')).getByText('shell')).toHaveAttribute('title', 'Set in the shell that started the app, so it wins over the files.');
  });

  it('a tab shows another environment, and .env.local only shows the shared file', async () => {
    serve({});
    show(<EnvironmentsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'dev' }));
    expect(within(rowOf('PORTAL_URL')).getByText('https://dev.example')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '.env.local only' }));
    expect(screen.getByRole('heading', { name: '.env.local' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('with no environments it says how to make one, and shows .env.local', async () => {
    serve({ envs: { ...ENVS, active: null, environments: [] } });
    show(<EnvironmentsPage />);
    expect(await screen.findByText(/No environments yet/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^\.env\.local only.*in use$/ })).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('NEW_USER_PASSWORD')).toBeInTheDocument();
  });

  it('files with no vars say so', async () => {
    serve({ envs: { active: null, shared: { file: '.env.local', vars: [] }, environments: [] } });
    show(<EnvironmentsPage />);
    expect(await screen.findByText('No vars in these files.')).toBeInTheDocument();
  });

  it('a failed load shows the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)));
    show(<EnvironmentsPage />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});

describe('EnvPicker', () => {
  it('shows the active environment and switches to another', async () => {
    const fetch = serve({});
    show(<EnvPicker />);
    const select = await screen.findByRole('combobox', { name: 'Environment' });
    await vi.waitFor(() => expect(select).toHaveValue('uat'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['none (.env.local)', 'dev', 'uat']);
    await userEvent.selectOptions(select, 'dev');
    expect(fetch.mock.calls.filter(([url]) => url === '/api/environments/active').map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ name: 'dev' }]);
  });

  it('none sends null', async () => {
    const fetch = serve({});
    show(<EnvPicker />);
    const select = await screen.findByRole('combobox', { name: 'Environment' });
    await vi.waitFor(() => expect(select).toHaveValue('uat'));
    await userEvent.selectOptions(select, '');
    expect(fetch.mock.calls.filter(([url]) => url === '/api/environments/active').map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ name: null }]);
  });

  it('is locked while a run goes', async () => {
    serve({ live: { id: 'r', title: 'x', startedAt: 0 } });
    show(<EnvPicker />);
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'Environment' })).toBeDisabled());
  });

  it('a refused switch is shown in the page', async () => {
    serve({ choose: () => json({ error: 'Wait for the run to end: a run keeps the environment it started in.' }, 409) });
    show(<EnvPicker />);
    const select = await screen.findByRole('combobox', { name: 'Environment' });
    await vi.waitFor(() => expect(select).toHaveValue('uat'));
    await userEvent.selectOptions(select, 'dev');
    expect(await screen.findByRole('dialog', { name: 'Could not switch the environment' })).toHaveTextContent('Wait for the run to end');
  });

  it('is hidden when there are no environments and none is active', async () => {
    const fetch = serve({ envs: { ...ENVS, active: null, environments: [] } });
    const { container } = show(<EnvPicker />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/environments', undefined));
    expect(container).toBeEmptyDOMElement();
  });
});
