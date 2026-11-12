import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowRun, Preset } from '../api.ts';
import { FlowsPage, RECENT_RUNS } from './FlowsPage.tsx';

let flows: Preset[] = [];
let runs: FlowRun[] = [];
vi.mock('../queries.ts', () => ({
  usePresets: () => ({ data: { fields: {}, flows } }),
  useFlowRuns: () => ({ data: runs }),
}));

const flow = (name: string, over: { group?: string; fns?: string[]; modifiedAt?: number } = {}): Preset => ({
  file: `config/flows/${name}.flow.json`,
  label: name,
  summary: (over.fns ?? ['Create']).join(' → '),
  spec: { ...(over.group && { group: over.group }), steps: (over.fns ?? ['Create']).map((f) => ({ function: f })) },
  ...(over.modifiedAt !== undefined && { modifiedAt: over.modifiedAt }),
});

const run = (id: string, startedAt: number, over: Partial<FlowRun> = {}): FlowRun => ({ id, name: id, startedAt, status: 'passed', steps: [], values: {}, ...over });

const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>;

const page = () =>
  render(
    <MemoryRouter initialEntries={['/flows']}>
      <Routes>
        <Route path="/flows" element={<FlowsPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

const flowTable = () => document.querySelector('table.flowtable') as HTMLTableElement;
const names = () => [...flowTable().querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent);
const header = (name: string) => within(flowTable()).getByRole('button', { name: new RegExp(`^${name}`) });
const view = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  localStorage.clear();
  flows = [flow('beta', { group: 'Web', fns: ['A', 'B', 'C'], modifiedAt: 2 }), flow('Alpha', { group: 'Admin', modifiedAt: 1 }), flow('gamma', { fns: ['A', 'B'] })];
  runs = [];
});
afterEach(() => localStorage.clear());

describe('FlowsPage views', () => {
  it('starts as a list, sorted by name, with a New flow button', () => {
    page();
    expect(view('List')).toHaveAttribute('aria-checked', 'true');
    expect(names()).toEqual(['Alpha', 'beta', 'gamma']);
    expect(screen.getByRole('link', { name: '+ New flow' })).toHaveAttribute('href', '/flow-builder');
    expect(screen.getByText('3 flows')).toBeInTheDocument();
  });

  it('Cards shows the grouped cards and remembers the choice', async () => {
    page();
    await userEvent.click(view('Cards'));
    expect(flowTable()).toBeNull();
    expect(screen.getByRole('region', { name: 'Web' })).toHaveTextContent('beta');
    expect(screen.getByRole('link', { name: /\+ New flow/ })).toHaveTextContent('Join functions');
    expect(localStorage.getItem('flowsView')).toBe('cards');
  });

  it('opens in the remembered view; anything else falls back to List', () => {
    localStorage.setItem('flowsView', 'cards');
    const { unmount } = page();
    expect(view('Cards')).toHaveAttribute('aria-checked', 'true');
    unmount();
    localStorage.setItem('flowsView', 'grid');
    page();
    expect(view('List')).toHaveAttribute('aria-checked', 'true');
  });

  it('one flow says "1 flow"', () => {
    flows = [flow('only')];
    page();
    expect(screen.getByText('1 flow')).toBeInTheDocument();
  });

  it('no saved flows: the list says so; Cards still offers a new flow', async () => {
    flows = [];
    page();
    expect(screen.getByText(/No saved flows yet/)).toBeInTheDocument();
    await userEvent.click(view('Cards'));
    expect(screen.getByRole('link', { name: /\+ New flow/ })).toBeInTheDocument();
  });
});

describe('FlowsPage list', () => {
  it('a row shows group, step count with the chain, last run and modified time', () => {
    runs = [run('r1', 100, { file: 'config/flows/beta.flow.json', status: 'failed' })];
    page();
    const beta = within(flowTable()).getByRole('link', { name: 'beta' }).closest('tr') as HTMLElement;
    const cells = within(beta).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Web');
    expect(cells[2]).toHaveTextContent('3A → B → C');
    expect(cells[2]).toHaveAttribute('title', 'A → B → C');
    expect(within(cells[3]).getByText('failed')).toBeInTheDocument();
    expect(within(cells[3]).getByRole('link')).toHaveAttribute('href', '/flow-run/r1');
    expect(cells[4].textContent).not.toBe('—');
  });

  it('no group, never run and unknown modified time show as such', () => {
    page();
    const gamma = within(flowTable()).getByRole('link', { name: 'gamma' }).closest('tr') as HTMLElement;
    const cells = within(gamma).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('—');
    expect(cells[3]).toHaveTextContent('Never');
    expect(cells[4]).toHaveTextContent('—');
  });

  it('a run with no file is not shown as any flow\'s last run', () => {
    runs = [run('beta', 100)];
    page();
    expect(within(flowTable()).queryByRole('link', { name: /Last run/ })).toBeNull();
  });

  it('clicking a row opens the flow in the builder', async () => {
    page();
    await userEvent.click(within(flowTable()).getByText('A → B'));
    expect(screen.getByTestId('where')).toHaveTextContent('/flow-builder?preset=config%2Fflows%2Fgamma.flow.json');
  });

  it('clicking the last run opens the run, not the flow', async () => {
    runs = [run('r1', 100, { file: 'config/flows/gamma.flow.json' })];
    page();
    await userEvent.click(within(flowTable()).getByRole('link', { name: /Last run passed/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/flow-run/r1');
  });
});

describe('FlowsPage sorting', () => {
  it('the current column says so; clicking it again flips the order', async () => {
    page();
    expect(header('Name').closest('th')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Group').closest('th')).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(header('Name'));
    expect(header('Name').closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['gamma', 'beta', 'Alpha']);
  });

  it('group: A to Z, flows with none last', async () => {
    page();
    await userEvent.click(header('Group'));
    expect(names()).toEqual(['Alpha', 'beta', 'gamma']);
    await userEvent.click(header('Group'));
    expect(names()).toEqual(['beta', 'Alpha', 'gamma']);
  });

  it('steps: fewest first', async () => {
    page();
    await userEvent.click(header('Steps'));
    expect(names()).toEqual(['Alpha', 'gamma', 'beta']);
  });

  it('last run: newest first, never run last', async () => {
    runs = [run('a', 1, { file: 'config/flows/Alpha.flow.json' }), run('g', 5, { file: 'config/flows/gamma.flow.json' })];
    page();
    await userEvent.click(header('Last run'));
    expect(header('Last run').closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['gamma', 'Alpha', 'beta']);
  });

  it('modified: newest first, unknown last', async () => {
    page();
    await userEvent.click(header('Modified'));
    expect(names()).toEqual(['beta', 'Alpha', 'gamma']);
  });

  it('the sort is remembered across visits', async () => {
    const { unmount } = page();
    await userEvent.click(header('Modified'));
    expect(JSON.parse(localStorage.getItem('flowsSort') ?? '')).toEqual({ key: 'modified', dir: 'desc' });
    unmount();
    page();
    expect(header('Modified').closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['beta', 'Alpha', 'gamma']);
  });

  it('a broken saved sort falls back to name, A to Z', () => {
    localStorage.setItem('flowsSort', '{oops');
    page();
    expect(names()).toEqual(['Alpha', 'beta', 'gamma']);
  });
});

describe('FlowsPage filter', () => {
  const filter = () => screen.getByRole('searchbox', { name: 'Filter flows' });

  it('narrows the list by name, group or step, and counts what is left', async () => {
    page();
    await userEvent.type(filter(), 'web');
    expect(names()).toEqual(['beta']);
    expect(screen.getByText('1 of 3 flows')).toBeInTheDocument();
    await userEvent.clear(filter());
    await userEvent.type(filter(), 'b');
    expect(names()).toEqual(['beta', 'gamma']);
  });

  it('narrows the cards too', async () => {
    page();
    await userEvent.click(view('Cards'));
    await userEvent.type(filter(), 'alpha');
    expect(screen.getByRole('link', { name: /^Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^beta/ })).toBeNull();
  });

  it('nothing matches: says so, and Clear filter brings every flow back', async () => {
    page();
    await userEvent.type(filter(), 'zzz');
    expect(screen.getByText(/No flow matches “zzz”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(filter()).toHaveValue('');
    expect(names()).toEqual(['Alpha', 'beta', 'gamma']);
  });

  it('spaces only do not filter', async () => {
    page();
    await userEvent.type(filter(), '   ');
    expect(names()).toHaveLength(3);
    expect(screen.getByText('3 flows')).toBeInTheDocument();
  });
});

describe('FlowsPage recent runs', () => {
  const runRows = () => screen.getAllByRole('row').filter((r) => !r.closest('table.flowtable') && within(r).queryAllByRole('cell').length);
  const many = (n: number) => Array.from({ length: n }, (_, i) => run(`run-${i}`, n - i));

  it('none: says so', () => {
    page();
    expect(screen.getByText('No flow has run yet.')).toBeInTheDocument();
  });

  it(`exactly ${RECENT_RUNS}: all shown, no Show all`, () => {
    runs = many(RECENT_RUNS);
    page();
    expect(runRows()).toHaveLength(RECENT_RUNS);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it(`more than ${RECENT_RUNS}: the newest ${RECENT_RUNS}, then Show all and Show fewer`, async () => {
    runs = many(RECENT_RUNS + 2);
    page();
    expect(runRows()).toHaveLength(RECENT_RUNS);
    await userEvent.click(screen.getByRole('button', { name: `Show all ${RECENT_RUNS + 2}` }));
    expect(runRows()).toHaveLength(RECENT_RUNS + 2);
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(runRows()).toHaveLength(RECENT_RUNS);
  });

  it('clicking a run opens it', async () => {
    runs = many(1);
    page();
    await userEvent.click(screen.getByText('run-0'));
    expect(screen.getByTestId('where')).toHaveTextContent('/flow-run/run-0');
  });
});
