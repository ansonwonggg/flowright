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
import { pillOf, RunCanvas, Steps } from './FlowRunPage.tsx';
import { FlowCards, passedSteps } from './FlowsPage.tsx';

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

describe('flow run with an IF', () => {
  const branchRun = (over: Partial<FlowRun> = {}): FlowRun => ({
    id: 'b',
    name: 'New member, SEP',
    startedAt: 0,
    status: 'running',
    values: { status: 'NEEDS_DDE' },
    steps: [
      { function: 'member-enrol', title: '[Web] Member Enrolment', status: 'passed', output: { status: 'NEEDS_DDE', enrolment_no: 'END1' }, runId: 'r1' },
      { if: { value: 'status', equals: 'NEEDS_DDE' }, title: 'If status is NEEDS_DDE', status: 'passed', taken: 'then', input: { status: 'NEEDS_DDE' } },
      { function: 'vet-enrolment', title: '[Admin] Vet Enrolment', status: 'running', input: { enrolment_no: 'END1' }, runId: 'r3', branch: { at: 1, arm: 'then' } },
      { function: 'note', title: 'Note', status: 'skipped', branch: { at: 1, arm: 'else' } },
    ],
    ...over,
  });
  const mount = (ui: React.ReactNode) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ run: { hasReport: false }, log: ['vetting'] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>,
    );
  };
  afterEach(() => vi.unstubAllGlobals());

  describe('RunCanvas', () => {
    const nodeOf = (n: number) => screen.getByRole('button', { name: new RegExp(`^Step ${n}:`) });

    it('draws a node per step, each saying its status; the IF says which way it went', () => {
      mount(<RunCanvas run={branchRun()} />);
      const canvas = screen.getByRole('group', { name: 'Flow canvas' });
      expect(within(canvas).getAllByRole('button')).toHaveLength(4);
      expect(nodeOf(1)).toHaveAccessibleName('Step 1: [Web] Member Enrolment, 2 values out');
      expect(nodeOf(2)).toHaveAccessibleName('Step 2: If status is NEEDS_DDE, took true');
      expect(nodeOf(3)).toHaveClass('st-running');
      expect(nodeOf(4)).toHaveClass('st-skipped');
    });

    it('arm steps sit in their branch; the branch not taken is dead', () => {
      mount(<RunCanvas run={branchRun()} />);
      expect(within(screen.getByLabelText('true branch')).getByRole('button', { name: /^Step 3:/ })).toBeInTheDocument();
      expect(within(screen.getByLabelText('false branch')).getByRole('button', { name: /^Step 4:/ })).toBeInTheDocument();
      expect(screen.getByLabelText('true branch')).toHaveClass('lit');
      expect(screen.getByLabelText('false branch')).toHaveClass('dead');
    });

    it('shows the running step by default, with its live log', async () => {
      mount(<RunCanvas run={branchRun()} />);
      expect(nodeOf(3)).toHaveAttribute('aria-pressed', 'true');
      const detail = screen.getByRole('region', { name: 'Step 3 details' });
      expect(detail).toHaveTextContent('[Admin] Vet Enrolment');
      expect(await within(detail).findByRole('region', { name: 'Step 3 log' })).toBeInTheDocument();
    });

    it('clicking a node shows its details: output for a function step', async () => {
      mount(<RunCanvas run={branchRun()} />);
      await userEvent.click(nodeOf(1));
      expect(nodeOf(1)).toHaveAttribute('aria-pressed', 'true');
      expect(within(screen.getByRole('region', { name: 'Step 1 details' })).getByLabelText('Step 1 output')).toHaveTextContent('END1');
    });

    it('the IF shows what it tested and the branch it took', async () => {
      mount(<RunCanvas run={branchRun()} />);
      await userEvent.click(nodeOf(2));
      const detail = screen.getByRole('region', { name: 'Step 2 details' });
      expect(detail).toHaveTextContent('Tests status is NEEDS_DDE. True runs 1 step, false runs 1.');
      expect(within(detail).getByTestId('if-result')).toHaveTextContent('status was NEEDS_DDE, so the flow took the true branch.');
      expect(within(detail).queryByRole('button', { name: 'Step 2 options' })).toBeNull();
    });

    it('an IF that tested a value no step gave says it was empty', async () => {
      const run = branchRun({ status: 'passed' });
      run.steps[1] = { ...run.steps[1], taken: 'else', input: { status: '' } };
      mount(<RunCanvas run={run} />);
      await userEvent.click(nodeOf(2));
      expect(screen.getByTestId('if-result')).toHaveTextContent('status was empty, so the flow took the false branch.');
    });

    it('a skipped step says why', async () => {
      mount(<RunCanvas run={branchRun()} />);
      await userEvent.click(nodeOf(4));
      expect(screen.getByRole('region', { name: 'Step 4 details' })).toHaveTextContent('Skipped: step 2 (If status is NEEDS_DDE) took the true branch.');
    });

    it('with nothing running, it shows the failed step', () => {
      const run = branchRun({ status: 'failed' });
      run.steps[2] = { ...run.steps[2], status: 'failed', error: 'DDE timed out' };
      mount(<RunCanvas run={run} />);
      expect(screen.getByRole('region', { name: 'Step 3 details' })).toHaveTextContent('DDE timed out');
    });

    it('a linear run draws its steps in a row with no branches', () => {
      mount(<RunCanvas run={{ ...branchRun(), steps: [branchRun().steps[0], { ...branchRun().steps[2], branch: undefined }] }} />);
      expect(screen.queryByLabelText('true branch')).toBeNull();
      expect(within(screen.getByRole('group', { name: 'Flow canvas' })).getAllByRole('button')).toHaveLength(2);
    });
  });

  describe('Steps list', () => {
    it('the IF and skipped steps get their own marks and words', () => {
      mount(<Steps run={branchRun()} />);
      expect(screen.getByTestId('step-2-status')).toHaveTextContent('passed');
      expect(screen.getByTestId('step-4-status')).toHaveTextContent('skipped');
      expect(screen.getByRole('listitem', { name: 'Step 3' })).toHaveClass('st-arm');
      expect(screen.getByRole('listitem', { name: 'Step 4' })).toHaveTextContent('took the true branch');
      expect(screen.queryByRole('button', { name: 'Step 4 options' })).toBeNull();
    });
  });
});

describe('passedSteps', () => {
  const run = (steps: FlowRun['steps']): FlowRun => ({ id: 'x', name: 'x', startedAt: 0, status: 'passed', values: {}, steps });
  it('counts function steps, leaving out IFs and skipped steps', () =>
    expect(
      passedSteps(
        run([
          { function: 'a', title: 'a', status: 'passed' },
          { if: { value: 's' }, title: 'If s is set', status: 'passed', taken: 'then' },
          { function: 'b', title: 'b', status: 'passed', branch: { at: 1, arm: 'then' } },
          { function: 'c', title: 'c', status: 'skipped', branch: { at: 1, arm: 'else' } },
          { function: 'd', title: 'd', status: 'waiting' },
        ]),
      ),
    ).toBe('2/3'));
  it('a linear run and an empty one', () => {
    expect(passedSteps(run([{ function: 'a', title: 'a', status: 'passed' }, { function: 'b', title: 'b', status: 'failed' }]))).toBe('1/2');
    expect(passedSteps(run([]))).toBe('0/0');
  });
});

describe('pillOf', () => {
  it('a skipped step has no colour of its own', () => expect(pillOf('skipped')).toBe(''));
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
  it('no saved flows: only the new flow card', () => {
    render(
      <MemoryRouter>
        <FlowCards flows={[]} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/flow-builder']);
  });
  it('no flow has a group: no group headings', () => {
    render(
      <MemoryRouter>
        <FlowCards flows={[flowPreset('a', {}), flowPreset('b', { group: ' ' })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
  it('flows with a group: a headed section per group in the order met, the rest under Other, New flow last', () => {
    render(
      <MemoryRouter>
        <FlowCards flows={[flowPreset('a', { group: 'Member' }), flowPreset('b', {}), flowPreset('c', { group: 'ER user' }), flowPreset('d', { group: 'Member' })]} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Member', 'ER user', 'Other']);
    const cardsIn = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('link').map((l) => l.querySelector('.t')?.textContent);
    expect(cardsIn('Member')).toEqual(['a', 'd']);
    expect(cardsIn('ER user')).toEqual(['c']);
    expect(cardsIn('Other')).toEqual(['b', '+ New flow']);
  });
});

const flowPreset = (label: string, spec: object) => ({ file: `config/flows/${label}.flow.json`, label, summary: '', spec: { steps: [], ...spec } });
