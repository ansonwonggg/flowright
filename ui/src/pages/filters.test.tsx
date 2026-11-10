import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { FieldJson, Presets } from '../api.ts';
import { HistoryTable, kindLabel, RecordCard, StatusPill } from '../components/bits.tsx';
import { ValueInput } from '../components/ValueInput.tsx';
import { FIELDS, FUNCTIONS, META, record, run } from '../lib/fixtures.test-utils.ts';
import { ago, duration, who } from '../lib/format.ts';
import { presetsFor } from './FunctionPage.tsx';
import { matchesHistory } from './HistoryPage.tsx';
import { cardNote, FunctionList } from './HomePage.tsx';

const fnOf = (id: string) => FUNCTIONS.find((f) => f.id === id)!;
const fieldOf = (name: string) => FIELDS.find((f) => f.name === name)!;
const PRESETS = { fields: { user_spec: [{ file: 'u' }, { file: 'u2' }], member_spec: [{ file: 'm' }], accounts: [{ file: 'a' }] }, flows: [] } as unknown as Presets;

describe('format', () => {
  it('duration', () => {
    expect(duration(0)).toBe('0s');
    expect(duration(59_400)).toBe('59s');
    expect(duration(60_000)).toBe('1m00s');
    expect(duration(125_000)).toBe('2m05s');
    for (const bad of [undefined, null, -1, NaN]) expect(duration(bad)).toBe('');
  });
  it('ago', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 3 * 86_400_000, now)).toBe(new Date(now - 3 * 86_400_000).toLocaleString());
  });
  it('who drops the ref and the stage', () => expect(who('DMD1 Company AP @ Acme · created', 'DMD1')).toBe('Company AP @ Acme'));
});

describe('matchesHistory', () => {
  const all = { status: 'all' as const, query: '' };
  it('all keeps everything', () => expect(matchesHistory(run({ status: 'failed' }), all)).toBe(true));
  it('passed keeps only passed', () => {
    expect(matchesHistory(run(), { ...all, status: 'passed' })).toBe(true);
    expect(matchesHistory(run({ status: 'failed' }), { ...all, status: 'passed' })).toBe(false);
  });
  it('failed keeps anything that ended otherwise, not running ones', () => {
    for (const status of ['failed', 'interrupted', 'timedout'] as const) expect(matchesHistory(run({ status }), { ...all, status: 'failed' })).toBe(true);
    for (const status of ['passed', 'running', 'stopping'] as const) expect(matchesHistory(run({ status }), { ...all, status: 'failed' })).toBe(false);
  });
  it('query searches title, summary, input values and records, ignoring case and spaces', () => {
    expect(matchesHistory(run({ input: { scheme: 'BCT Pro' } }), { ...all, query: '  bct PRO ' })).toBe(true);
    expect(matchesHistory(run(), { ...all, query: 'rgd1' })).toBe(true);
    expect(matchesHistory(run(), { ...all, query: 'register' })).toBe(true);
    expect(matchesHistory(run(), { ...all, query: 'nothing' })).toBe(false);
  });
  it('a run with no input or records still matches by title', () => expect(matchesHistory(run({ input: undefined as never, records: undefined as never }), { ...all, query: 'register' })).toBe(true));
});

describe('presetsFor / cardNote', () => {
  it('presetsFor gives a JSON field\'s presets by its name, when it has a presets folder; none for anything else', () => {
    expect(presetsFor(fieldOf('user_spec'), PRESETS).map((p) => p.file)).toEqual(['u', 'u2']);
    expect(presetsFor(fieldOf('member_spec'), PRESETS)[0].file).toBe('m');
    expect(presetsFor(fieldOf('accounts'), PRESETS)[0].file).toBe('a');
    expect(presetsFor(fieldOf('mobile'), PRESETS)).toEqual([]);
    expect(presetsFor(undefined, PRESETS)).toEqual([]);
    expect(presetsFor(fieldOf('user_spec'), undefined)).toEqual([]);
    expect(presetsFor({ name: 'x', kind: 'json', label: 'X', presets: 'nope' } as FieldJson, PRESETS)).toEqual([]);
    expect(presetsFor({ name: 'user_spec', kind: 'json', label: 'X' } as FieldJson, PRESETS)).toEqual([]);
  });
  it('cardNote: a function with a JSON input counts its presets', () => {
    expect(cardNote(fnOf('create-user'), META, PRESETS)).toBe('2 saved presets');
    expect(cardNote(fnOf('view-permissions'), META, PRESETS)).toBe('1 saved preset');
  });
  it('cardNote: any other function counts the saved flows that use it', () => {
    const flows = [
      { file: 'a', spec: { steps: [{ function: 'create-user' }, { function: 'vet-datamod' }, { function: 'activate-api' }] } },
      { file: 'b', spec: { steps: [{ function: 'create-user' }, { function: 'vet-datamod' }, { function: 'vet-datamod' }] } },
      { file: 'c', spec: { steps: [{ function: 'member-register' }] } },
    ];
    const presets = { ...PRESETS, flows } as unknown as Presets;
    expect(cardNote(fnOf('vet-datamod'), META, presets)).toBe('Used in 2 flows');
    expect(cardNote(fnOf('activate-api'), META, presets)).toBe('Used in 1 flow');
    expect(cardNote(fnOf('member-enrol'), META, presets)).toBe('Not in any flow');
  });
  it('cardNote: no presets loaded yet, or a flow file that is not a flow, counts nothing', () => {
    expect(cardNote(fnOf('vet-datamod'), META, undefined)).toBe('Not in any flow');
    const odd = { ...PRESETS, flows: [{ file: 'x', spec: undefined }, { file: 'y', spec: { steps: 'no' } }, { file: 'z', spec: { steps: [null, { function: 'vet-datamod' }] } }] } as unknown as Presets;
    expect(cardNote(fnOf('vet-datamod'), META, odd)).toBe('Used in 1 flow');
  });
  it("cardNote: a function in an IF's branch counts as used", () => {
    const flows = [{ file: 'a', spec: { steps: [{ function: 'create-user' }, { if: { value: 'status' }, then: [], else: [{ function: 'activate-api' }] }] } }];
    expect(cardNote(fnOf('activate-api'), META, { ...PRESETS, flows } as unknown as Presets)).toBe('Used in 1 flow');
  });
});

describe('bits', () => {
  it('StatusPill shows the status with its test id', () => {
    render(<StatusPill status="interrupted" testId="run-status" />);
    expect(screen.getByTestId('run-status')).toHaveTextContent('interrupted');
    expect(screen.getByTestId('run-status')).toHaveClass('pill', 'interrupted');
  });

  it('HistoryTable shows the first failure and opens a run on click', async () => {
    const open = vi.fn();
    render(<HistoryTable runs={[run({ status: 'failed', view: { failures: [{ title: 'A check failed' } as never] } })]} onOpen={open} />);
    expect(screen.getByText('✗ A check failed')).toBeInTheDocument();
    expect(screen.getByText('1m05s')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('row', { name: /Register/ }));
    expect(open).toHaveBeenCalledWith('20261105-120000-aaaa');
  });

  it('HistoryTable leaves the duration blank for a run without an end', () => {
    render(<HistoryTable runs={[run({ endedAt: undefined, status: 'running' })]} onOpen={() => {}} />);
    expect(screen.queryByText(/\d+s$/)).not.toBeInTheDocument();
  });

  it('RecordCard shows the current stage, login with copy, and a run link per function that takes it', () => {
    render(
      <MemoryRouter>
        <RecordCard made={{ kind: 'er-user', ref: 'DMD1', stage: 'create-user', stageLabel: 'Create', summary: 'DMD1 Company AP @ Acme' }} full={record()} meta={META} />
      </MemoryRouter>,
    );
    expect(screen.getByText('ER user')).toBeInTheDocument();
    expect(screen.getByText('etoe.abc')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    expect(screen.getByText('Create · SUBMITTED')).toHaveClass('chip');
    expect(screen.getByRole('link', { name: 'Run: [Admin] Vet →' })).toHaveAttribute('href', '/fn/vet-datamod?ref=DMD1');
  });

  it('RecordCard without the current record falls back to what the run saw, with no links; an unknown kind shows as itself', () => {
    render(
      <MemoryRouter>
        <RecordCard made={{ kind: 'thing', ref: 'RGD1', stage: 'member-enrol', stageLabel: 'Enrol · ACCOUNT_OPENED', summary: 'RGD1 Member 1' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('thing')).toBeInTheDocument();
    expect(screen.getByText('Enrol · ACCOUNT_OPENED')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('kindLabel', () => {
  it("the kit's label for a kind; the kind itself when unknown or before meta loads", () => {
    expect(kindLabel('er-user', META)).toBe('ER user');
    expect(kindLabel('thing', META)).toBe('thing');
    expect(kindLabel('er-user', undefined)).toBe('er-user');
  });
});

describe('ValueInput', () => {
  const Harness = ({ field, spy = () => {} }: { field: FieldJson; spy?: (v: string) => void }) => {
    const [value, setValue] = useState('');
    return (
      <>
        <label htmlFor="x">{field.label}</label>
        <ValueInput
          id="x"
          field={field}
          meta={META}
          value={value}
          placeholder="from the record"
          onChange={(v) => {
            setValue(v);
            spy(v);
          }}
        />
      </>
    );
  };
  it('text: typing sets the value; the placeholder shows', async () => {
    const spy = vi.fn();
    render(<Harness field={fieldOf('mobile')} spy={spy} />);
    expect(screen.getByLabelText('Mobile')).toHaveAttribute('placeholder', 'from the record');
    await userEvent.type(screen.getByLabelText('Mobile'), '9');
    expect(spy).toHaveBeenLastCalledWith('9');
  });
  it('secret: a password box', () => {
    render(<Harness field={fieldOf('password')} />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
  it('select: the field\'s options, named by its labels; the placeholder is the empty choice', async () => {
    const spy = vi.fn();
    render(<Harness field={fieldOf('account_type')} spy={spy} />);
    expect(screen.getByRole('option', { name: 'from the record' })).toHaveValue('');
    await userEvent.selectOptions(screen.getByLabelText('Account type'), 'PA');
    expect(screen.getByRole('option', { name: 'PA: Personal Account' })).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith('PA');
  });
  it('a text field with an options list named after it gets a datalist', () => {
    const { container } = render(<Harness field={fieldOf('scheme')} />);
    expect(screen.getByLabelText('Scheme')).toHaveAttribute('list', 'x-list');
    expect(container.querySelector('#x-list option')).toHaveAttribute('value', 'BCT (MPF) Pro Choice');
  });
  it('an option the field has no label for shows as itself', () => {
    render(<Harness field={{ name: 'kind', kind: 'select', label: 'Kind', options: ['A'] }} />);
    expect(screen.getByRole('option', { name: 'A' })).toHaveValue('A');
  });
  it('no suggestion list: no datalist', () => {
    render(<Harness field={fieldOf('username')} />);
    expect(screen.getByLabelText('Username')).not.toHaveAttribute('list');
  });
});

describe('FunctionList', () => {
  const list = (fns: typeof FUNCTIONS) =>
    render(
      <MemoryRouter>
        <FunctionList fns={fns} meta={META} presets={PRESETS} />
      </MemoryRouter>,
    );
  it('no function has a group: one flat list, no headings', () => {
    list(FUNCTIONS);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(FUNCTIONS.length);
  });
  it('functions with a group: a headed section per group in list order, the rest under Other', () => {
    const [a, b, c, ...rest] = FUNCTIONS;
    list([{ ...a, group: 'Web' }, { ...b, group: 'Admin' }, { ...c, group: 'Web' }, ...rest]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Web', 'Admin', 'Other']);
    const idsIn = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(idsIn('Web')).toEqual([`/fn/${a.id}`, `/fn/${c.id}`]);
    expect(idsIn('Admin')).toEqual([`/fn/${b.id}`]);
    expect(idsIn('Other')).toEqual(rest.map((f) => `/fn/${f.id}`));
  });
});
