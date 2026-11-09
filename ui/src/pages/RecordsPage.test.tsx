import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FunctionGroup } from '../lib/byFunction.ts';
import { FUNCTIONS, record, run } from '../lib/fixtures.test-utils.ts';
import { FunctionSection } from './RecordsPage.tsx';

const fn = FUNCTIONS[0];
const userRun = (over = {}) => run({ project: 'create-user', title: fn.title, input: { user_spec: '{"company":"PCCW"}', view_as: 'G1' }, summary: 'Company AP for PCCW, by ER', ...over });
const current = record({ stage: 'vet-datamod', stageLabel: 'Vet · SUCCEED', next: [{ id: 'activate-api', title: '[API] Activate' }] });
const made = { kind: 'er-user', ref: 'DMD1', stage: 'create-user', stageLabel: 'Create · SUBMITTED', summary: 'DMD1 Company AP @ PCCW' };

const Harness = ({ group }: { group: FunctionGroup }) => {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FunctionSection group={group} open={open} onToggle={(k) => setOpen(open === k ? null : k)} />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const stubLog = (log: string[]) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ run: {}, log }), { status: 200, headers: { 'content-type': 'application/json' } })));

afterEach(() => vi.unstubAllGlobals());

describe('FunctionSection', () => {
  it('lists rows with the record, its stage now, the result and counts', () => {
    render(<Harness group={{ fn, passed: 1, failed: 1, rows: [{ key: 'a:DMD1', run: userRun(), made, current }, { key: 'b', run: userRun({ id: 'b', status: 'failed' }) }] }} />);
    expect(screen.getByRole('button', { name: /Create ER User/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('✓ 1')).toBeInTheDocument();
    expect(screen.getByText('✗ 1')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /DMD1 Company AP @ PCCW Vet · SUCCEED passed/ })).toBeInTheDocument();
    expect(screen.getByText('Vet · SUCCEED')).toHaveClass('todo');
    expect(screen.getByRole('row', { name: /— nothing saved failed/ })).toBeInTheDocument();
  });

  it('a record with nothing left to run shows its stage as done', () => {
    render(<Harness group={{ fn, passed: 1, failed: 0, rows: [{ key: 'a:DMD1', run: userRun(), made, current: { ...current, next: [] } }] }} />);
    expect(screen.getByText('Vet · SUCCEED')).toHaveClass('done');
  });

  it('a row opens to its inputs, output with copy and next, and the log', async () => {
    stubLog(['Running create-user', '  ✓ 1 CREATE']);
    render(<Harness group={{ fn, passed: 1, failed: 0, rows: [{ key: 'a:DMD1', run: userRun(), made, current }] }} />);
    await userEvent.click(screen.getByRole('row', { name: /DMD1/ }));
    expect(screen.getByText('Company AP for PCCW, by ER')).toBeInTheDocument();
    expect(screen.getByText('view_as')).toBeInTheDocument();
    expect(screen.getByText('{"company":"PCCW"}')).toBeInTheDocument();
    expect(screen.getByText('etoe.abc')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    expect(screen.getByText(/After this run it was Create · SUBMITTED; it has moved on since/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next: [API] Activate →' })).toHaveAttribute('href', '/fn/activate-api?ref=DMD1');
    expect(screen.getByRole('link', { name: /Playwright report/ })).toHaveAttribute('href', '/runs/20261105-120000-aaaa/report/');
    expect(screen.getByRole('link', { name: 'Open run →' })).toHaveAttribute('href', '/run/20261105-120000-aaaa');
    expect(await screen.findByText(/Running create-user/)).toBeInTheDocument();
  });

  it('a failed run that saved nothing explains why and has no report link when none was kept', async () => {
    stubLog([]);
    const failure = { type: 'failure', test: 't', step: '2 SUBMIT', kind: 'portal', title: 'DEV returned an error', hint: 'Try later.', error: 'x' };
    render(<Harness group={{ fn, passed: 0, failed: 1, rows: [{ key: 'b', run: userRun({ id: 'b', status: 'failed', hasReport: false, view: { failures: [failure as never] } }) }] }} />);
    await userEvent.click(screen.getByRole('row', { name: /nothing saved/ }));
    expect(screen.getByText('Nothing was saved under out/records.')).toBeInTheDocument();
    expect(screen.getByText('✗ DEV returned an error')).toBeInTheDocument();
    expect(screen.getByText('Try later.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Playwright report/ })).not.toBeInTheDocument();
    expect(await screen.findByText('This run kept no log.')).toBeInTheDocument();
  });

  it('a record that is gone shows what the run saw', async () => {
    stubLog([]);
    render(<Harness group={{ fn, passed: 1, failed: 0, rows: [{ key: 'a:DMD1', run: userRun(), made }] }} />);
    await userEvent.click(screen.getByRole('row', { name: /DMD1/ }));
    expect(screen.getByText(/The record is no longer under out\/records/)).toBeInTheDocument();
  });

  it('the header folds the section', async () => {
    render(<Harness group={{ fn, passed: 1, failed: 0, rows: [{ key: 'a:DMD1', run: userRun(), made, current }] }} />);
    await userEvent.click(screen.getByRole('button', { name: /Create ER User/ }));
    expect(screen.getByRole('button', { name: /Create ER User/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
