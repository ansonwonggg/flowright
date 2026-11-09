import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowRun } from '../api.ts';
import { FUNCTIONS, META } from '../lib/fixtures.test-utils.ts';
import { flowOf, type DraftStep } from '../lib/flowDraft.ts';
import { StepCard } from './StepCard.tsx';
import { pillOf, Steps } from './FlowRunPage.tsx';
import { FlowCards } from './FlowsPage.tsx';

const Harness = ({ steps, index = 0, spy = () => {}, onRemove = () => {} }: { steps: DraftStep[]; index?: number; spy?: (s: DraftStep) => void; onRemove?: () => void }) => {
  const [all, setAll] = useState(steps);
  const step = all[index];
  return (
    <StepCard
      index={index}
      step={step}
      fn={FUNCTIONS.find((f) => f.id === step.fn)}
      flow={flowOf(all, META.fields)}
      meta={META}
      onChange={(s) => {
        setAll(all.map((x, i) => (i === index ? s : x)));
        spy(s);
      }}
      onRemove={onRemove}
    />
  );
};
const step = (fn: string, over: Partial<DraftStep> = {}): DraftStep => ({ key: fn, fn, values: {}, forms: {}, ...over });

describe('StepCard', () => {
  it('bare: no heading and no Remove, the inputs stay', () => {
    render(<StepCard bare index={0} step={step('vet-datamod')} fn={FUNCTIONS[1]} flow={{ steps: [{ function: 'vet-datamod' }] }} meta={META} onChange={() => {}} onRemove={() => {}} />);
    const card = screen.getByRole('region', { name: 'Step 1' });
    expect(within(card).queryByRole('heading')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Remove step 1' })).toBeNull();
    expect(within(card).getByLabelText(/DataMod ref/)).toBeInTheDocument();
    expect(within(card).queryByText(/^Gives:/)).toBeNull();
  });

  it('names the step and function, and lists what it gives', () => {
    render(<Harness steps={[step('vet-datamod')]} />);
    const card = screen.getByRole('region', { name: 'Step 1' });
    expect(within(card).getByRole('heading')).toHaveTextContent('1 [Admin] Vet');
    expect(within(card).getByText('Gives: reference_no, status')).toBeInTheDocument();
  });

  it('a required input nothing gives is starred; its placeholder is the field\'s', () => {
    render(<Harness steps={[step('vet-datamod')]} />);
    expect(screen.getByText('DataMod ref').parentElement).toHaveTextContent('DataMod ref *');
    expect(screen.getByLabelText(/DataMod ref/)).toHaveAttribute('placeholder', 'DMD…');
  });

  it('inputs an earlier step or the record gives are not starred, and say so', () => {
    render(<Harness steps={[step('create-user'), step('activate-api')]} index={1} />);
    expect(screen.getByLabelText('DataMod ref')).toHaveAttribute('placeholder', 'from step 1');
    expect(screen.getByLabelText('Mobile')).toHaveAttribute('placeholder', 'from step 1');
    expect(screen.getByLabelText('Username')).toHaveAttribute('placeholder', 'etoe.<stamp>');
  });

  it('typing sets the value by name; a password field hides it', async () => {
    const spy = vi.fn();
    render(<Harness steps={[step('activate-api')]} spy={spy} />);
    await userEvent.type(screen.getByLabelText(/Mobile/), '9');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ values: { mobile: '9' } }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('a JSON input shows its form and edits it', async () => {
    const spy = vi.fn();
    render(<Harness steps={[step('create-user', { forms: { user_spec: { creator: 'ER', userType: 'Company AP' } } })]} spy={spy} />);
    await userEvent.type(screen.getByLabelText('Company'), 'P');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ forms: { user_spec: expect.objectContaining({ company: 'P' }) } }));
  });

  it('remove', async () => {
    const onRemove = vi.fn();
    render(<Harness steps={[step('vet-datamod')]} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('an unknown function says so and can still be removed', () => {
    render(<Harness steps={[step('nope')]} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Unknown function "nope"');
    expect(screen.getByRole('button', { name: 'Remove step 1' })).toBeInTheDocument();
  });

  it('a function with no outputs says it gives nothing', () => {
    render(<Harness steps={[step('view-permissions')]} />);
    expect(screen.getByText('Gives: nothing')).toBeInTheDocument();
  });
});

describe('flow run Steps', () => {
  const run: FlowRun = {
    id: 'c',
    name: 'New ER user',
    startedAt: 0,
    status: 'failed',
    values: { reference_no: 'DMD1' },
    steps: [
      { function: 'create-user', title: 'Create', status: 'passed', input: { company: 'PCCW' }, output: { reference_no: 'DMD1' }, runId: 'r1' },
      { function: 'vet-datamod', title: 'Vet', status: 'failed', input: { reference_no: 'DMD1' }, error: 'A check failed: still SUBMIT', runId: 'r2' },
      { function: 'activate-api', title: 'Activate', status: 'waiting' },
    ],
  };
  const logs: Record<string, string[]> = { r1: ['creating', 'created DMD1'], r2: ['vetting', 'still SUBMIT'], r3: ['logging in', 'filling the form'] };
  const withReport = new Set(['r1', 'r2', 'r3']);

  const show = (r: FlowRun) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const id = decodeURIComponent(String(url).split('/api/runs/')[1] ?? '');
        if (!logs[id]) return new Response(JSON.stringify({ error: 'no such run' }), { status: 404, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ run: { hasReport: withReport.has(id) }, log: logs[id] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Steps run={r} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };
  const stepEl = (n: number) => screen.getByRole('listitem', { name: `Step ${n}` });
  const menu = async (n: number) => userEvent.click(screen.getByRole('button', { name: `Step ${n} options` }));

  afterEach(() => {
    vi.unstubAllGlobals();
    withReport.add('r1');
  });

  it("a finished step with a kept report links to it, in a new tab", async () => {
    show(run);
    const report = await within(stepEl(1)).findByRole('link', { name: 'Report ↗' });
    expect(report).toHaveAttribute('href', '/runs/r1/report/');
    expect(report).toHaveAttribute('target', '_blank');
    expect(await within(stepEl(2)).findByRole('link', { name: 'Report ↗' })).toHaveAttribute('href', '/runs/r2/report/');
  });

  it('no report link while running, without a kept report, or without a run', async () => {
    withReport.delete('r1');
    show({ ...run, status: 'running', steps: [run.steps[0], { ...run.steps[1], status: 'running', error: undefined, runId: 'r3' }, { ...run.steps[1], runId: undefined }] });
    await screen.findByRole('region', { name: 'Step 2 log' });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Step 2 log' })).toHaveTextContent('logging in'));
    expect(screen.queryByRole('link', { name: 'Report ↗' })).toBeNull();
  });

  it('each step has its status', () => {
    show(run);
    expect(screen.getByTestId('step-1-status')).toHaveTextContent('passed');
    expect(screen.getByTestId('step-2-status')).toHaveClass('pill', 'failed');
    expect(screen.getByTestId('step-3-status')).toHaveTextContent('waiting');
  });

  it('a running step shows its live log, open, and neither input nor output', async () => {
    show({ ...run, status: 'running', steps: [{ function: 'create-user', title: 'Create', status: 'running', input: { company: 'PCCW' }, runId: 'r3' }] });
    const log = await screen.findByRole('region', { name: 'Step 1 log' });
    await waitFor(() => expect(log).toHaveTextContent('logging in filling the form'));
    expect(log.querySelector('details')).toHaveAttribute('open');
    expect(screen.queryByLabelText('Step 1 input')).toBeNull();
    expect(screen.queryByText('Output')).toBeNull();
  });

  it('a passed step shows its output and no log', () => {
    show(run);
    expect(screen.getByLabelText('Step 1 output')).toHaveTextContent('reference_noDMD1');
    expect(screen.queryByRole('region', { name: 'Step 1 log' })).toBeNull();
  });

  it('a failed step shows its error and its log, open, and no output', async () => {
    show(run);
    expect(within(stepEl(2)).getByText('A check failed: still SUBMIT')).toBeInTheDocument();
    const log = await screen.findByRole('region', { name: 'Step 2 log' });
    await waitFor(() => expect(log).toHaveTextContent('vetting still SUBMIT'));
    expect(log.querySelector('details')).toHaveAttribute('open');
    expect(screen.queryByLabelText('Step 2 output')).toBeNull();
  });

  it('a stopped step shows its log too', async () => {
    show({ ...run, steps: [{ ...run.steps[1], status: 'stopped', error: undefined }] });
    expect(await screen.findByRole('region', { name: 'Step 1 log' })).toBeInTheDocument();
  });

  it('input is behind the menu: Input shows it, choosing it again hides it', async () => {
    show(run);
    expect(screen.queryByLabelText('Step 1 input')).toBeNull();
    await menu(1);
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Input' }));
    expect(screen.getByLabelText('Step 1 input')).toHaveTextContent('companyPCCW');
    await menu(1);
    expect(screen.getByRole('menuitemcheckbox', { name: '✓Input' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: '✓Input' }));
    expect(screen.queryByLabelText('Step 1 input')).toBeNull();
  });

  it("Log in the menu shows a passed step's log, and hides a failed step's", async () => {
    show(run);
    await menu(1);
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Log' }));
    const log = await screen.findByRole('region', { name: 'Step 1 log' });
    await waitFor(() => expect(log).toHaveTextContent('creating created DMD1'));
    expect(log.querySelector('details')).toHaveAttribute('open');
    await menu(2);
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: '✓Log' }));
    expect(screen.queryByRole('region', { name: 'Step 2 log' })).toBeNull();
  });

  it('the menu links to the step\'s run in History', async () => {
    show(run);
    await menu(2);
    expect(screen.getByRole('menuitem', { name: 'Open in History' })).toHaveAttribute('href', '/run/r2');
  });

  it('a waiting step has no menu', () => {
    show(run);
    expect(screen.queryByRole('button', { name: 'Step 3 options' })).toBeNull();
  });

  it('a step without a run (an older flow run, or one that could not start): Input only, no log', async () => {
    show({ ...run, steps: [{ function: 'vet-datamod', title: 'Vet', status: 'failed', input: {}, error: "can't start: needs Mobile" }] });
    await menu(1);
    expect(screen.getAllByRole('menuitemcheckbox').map((m) => m.textContent)).toEqual(['Input']);
    expect(screen.queryByRole('menuitem', { name: 'Open in History' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Step 1 log' })).toBeNull();
  });

  it('a log that cannot be loaded says so', async () => {
    show({ ...run, steps: [{ ...run.steps[1], runId: 'gone' }] });
    expect(await screen.findByText('No log: no such run')).toBeInTheDocument();
  });
});

describe('pillOf', () => {
  it('maps flow words onto run colours', () => {
    expect(pillOf('stopped')).toBe('interrupted');
    expect(pillOf('waiting')).toBe('');
    for (const s of ['running', 'passed', 'failed']) expect(pillOf(s)).toBe(s);
  });
});

describe('FlowCards', () => {
  it('a card per saved flow opens the builder on it, plus a new flow card', () => {
    render(
      <MemoryRouter>
        <FlowCards flows={[{ file: 'config/flows/new-er-user.flow.json', label: 'new-er-user', summary: 'A → B', spec: {} }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /new-er-user/ })).toHaveAttribute('href', '/flow-builder?preset=config%2Fflows%2Fnew-er-user.flow.json');
    expect(screen.getByRole('link', { name: /new-er-user/ })).toHaveTextContent('A → B');
    expect(screen.getByRole('link', { name: /New flow/ })).toHaveAttribute('href', '/flow-builder');
  });
});
