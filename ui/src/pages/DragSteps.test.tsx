import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Preset } from '../api.ts';
import { fn, META } from '../lib/fixtures.test-utils.ts';
import { flowOf, isDraftIf, type DraftItem, type DraftStep } from '../lib/flowDraft.ts';
import { DragSteps } from './DragSteps.tsx';

const step = (fn: string): DraftStep => ({ key: fn, fn, values: {}, forms: {} });

let latest: DraftItem[] = [];
const Harness = ({ steps, errors = [], flows }: { steps: DraftItem[]; errors?: string[]; flows?: Preset[] }) => {
  const [all, setAll] = useState(steps);
  latest = all;
  return <DragSteps steps={all} flow={flowOf(all, META.fields)} meta={META} errors={errors} onSteps={setAll} flows={flows} />;
};

const order = () => latest.map((s) => (isDraftIf(s) ? 'IF' : s.fn));
const chip = (title: string) => screen.getByRole('button', { name: `Add ${title}` }).closest('.fn-chip') as HTMLElement;
const tile = (n: number) => screen.getByLabelText(`Step ${n} tile`);
const gap = (n: number) => screen.getByTestId(`gap-${n}`);
const dataTransfer = { setData: () => {}, effectAllowed: '' };
const dragTo = (from: HTMLElement, to: HTMLElement) => {
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to);
  fireEvent.drop(to);
  fireEvent.dragEnd(from);
};

describe('DragSteps', () => {
  it('an empty flow: one drop zone, every function in the palette', () => {
    render(<Harness steps={[]} />);
    expect(gap(0)).toHaveTextContent('Drag a function here to start');
    for (const f of META.functions) expect(chip(f.title)).not.toHaveClass('off');
  });

  it('+ adds the function at the end', async () => {
    render(<Harness steps={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add [Web] Create ER User' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add [Admin] Vet' }));
    expect(order()).toEqual(['create-user', 'vet-datamod']);
    expect(tile(1)).toHaveTextContent('Web' + 'Create ER User');
    expect(within(tile(1)).getByText('Gives: reference_no, mobile, company')).toBeInTheDocument();
  });

  it('every function can be dragged and added, whatever the flow holds', async () => {
    render(<Harness steps={[step('create-user')]} />);
    for (const title of ['[Web] Create ER User', '[Admin] Vet', '[Web] Register', '[Web] Enrol']) {
      expect(chip(title)).not.toHaveClass('off');
      expect(chip(title)).toHaveAttribute('draggable', 'true');
      expect(screen.getByRole('button', { name: `Add ${title}` })).toBeEnabled();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Add [Web] Enrol' }));
    expect(order()).toEqual(['create-user', 'member-enrol']);
  });

  it('dragging a function lights up every gap', () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod')]} />);
    fireEvent.dragStart(chip('[API] Activate'), { dataTransfer });
    expect(gap(0)).toHaveClass('ok');
    expect(gap(1)).toHaveClass('ok');
    expect(gap(2)).toHaveClass('ok');
    fireEvent.dragOver(gap(1));
    expect(gap(1)).toHaveClass('over');
    fireEvent.dragLeave(gap(1));
    expect(gap(1)).not.toHaveClass('over');
    fireEvent.dragEnd(chip('[API] Activate'));
    expect(gap(1)).not.toHaveClass('ok');
  });

  it('dropping a function into a gap inserts it there', () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod')]} />);
    dragTo(chip('[API] Activate'), gap(1));
    expect(order()).toEqual(['create-user', 'activate-api', 'vet-datamod']);
  });

  it('a starting function dropped first in a flow without one', () => {
    render(<Harness steps={[step('vet-datamod')]} />);
    dragTo(chip('[Web] Create ER User'), gap(0));
    expect(order()).toEqual(['create-user', 'vet-datamod']);
  });

  it('a function dropped before a starting one goes there too', () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod')]} />);
    dragTo(chip('[API] Activate'), gap(0));
    expect(order()).toEqual(['activate-api', 'create-user', 'vet-datamod']);
  });

  it('dragging a step moves it, and fades it while it moves', () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod'), step('activate-api')]} />);
    fireEvent.dragStart(tile(2), { dataTransfer });
    expect(tile(2)).toHaveClass('moving');
    expect(gap(1)).not.toHaveClass('ok');
    expect(gap(2)).not.toHaveClass('ok');
    fireEvent.drop(gap(3));
    expect(order()).toEqual(['create-user', 'activate-api', 'vet-datamod']);
  });

  it('a step dragged onto either gap beside it stays put', () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod'), step('activate-api')]} />);
    dragTo(tile(2), gap(2));
    expect(order()).toEqual(['create-user', 'vet-datamod', 'activate-api']);
  });

  it('↑ and ↓ move a step, and are off only at the ends', async () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod'), step('activate-api')]} />);
    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step 1 down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move step 2 up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move step 3 down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move step 2 down' }));
    expect(order()).toEqual(['create-user', 'activate-api', 'vet-datamod']);
    await userEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }));
    expect(order()).toEqual(['activate-api', 'create-user', 'vet-datamod']);
  });

  it('✕ removes the step', async () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod')]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
    expect(order()).toEqual(['create-user']);
  });

  it("Inputs opens the step's inputs in place; typing there edits the step; Hide closes them", async () => {
    render(<Harness steps={[step('vet-datamod')]} />);
    expect(screen.queryByRole('region', { name: 'Step 1' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Inputs' }));
    await userEvent.type(within(screen.getByRole('region', { name: 'Step 1' })).getByLabelText(/DataMod ref/), 'D');
    expect((latest[0] as DraftStep).values).toEqual({ reference_no: 'D' });
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('region', { name: 'Step 1' })).toBeNull();
  });

  it('an unknown function shows as such and does not block the rest', () => {
    render(<Harness steps={[step('nope'), step('vet-datamod')]} />);
    expect(tile(1)).toHaveTextContent('Unknown function "nope"');
    expect(chip('[API] Activate')).not.toHaveClass('off');
  });

  it('Start says what the flow begins on; End lists what it gives', () => {
    render(<Harness steps={[]} />);
    expect(screen.getByText(/▶ Start/)).toBeInTheDocument();
    expect(screen.getByText('■ End')).toBeInTheDocument();
  });

  it('a flow on a new record, then on an existing one', async () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod')]} />);
    expect(screen.getByText('▶ A new ER user')).toBeInTheDocument();
    expect(screen.getByText('Gives reference_no, mobile, company, status')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    expect(screen.getByText('▶ An existing ER user')).toBeInTheDocument();
  });

  it('an arrow shows the values handed down to the next step; the first and last arrows show none', () => {
    render(<Harness steps={[step('create-user'), step('vet-datamod'), step('activate-api')]} />);
    expect(within(gap(1)).getByText('reference_no')).toBeInTheDocument();
    expect(within(gap(2)).getAllByRole('code').map((c) => c.textContent)).toEqual(['reference_no', 'mobile']);
    expect(within(gap(0)).queryByRole('code')).toBeNull();
    expect(within(gap(3)).queryByRole('code')).toBeNull();
  });

  it('more than two values: two and a count; the full list is in the tooltip', () => {
    const fns = [fn('make', { starts: true, record: 'er-user', outputs: ['a', 'b', 'c', 'd'] }), fn('use', { record: 'er-user', inputs: { a: 'required', b: 'required', c: 'optional', d: 'optional' } })];
    render(<DragSteps steps={[step('make'), step('use')]} flow={{ steps: [{ function: 'make' }, { function: 'use' }] }} meta={{ ...META, functions: fns }} errors={[]} onSteps={() => {}} />);
    expect(within(gap(1)).getAllByRole('code').map((c) => c.textContent)).toEqual(['a', 'b', '+2']);
    expect(gap(1).querySelector('.carry')).toHaveAttribute('title', 'Handed down from earlier steps: a, b, c, d');
  });

  it('a value typed on the step is not shown as handed down', () => {
    render(<Harness steps={[step('create-user'), { ...step('activate-api'), values: { mobile: '91234567' } }]} />);
    expect(within(gap(1)).getAllByRole('code').map((c) => c.textContent)).toEqual(['reference_no']);
  });

  it("each step shows its own check errors, at most two and a count", () => {
    const errors = ['Step 1: a', 'Step 2: b', 'Step 2: c', 'Step 2: d', 'flow: e'];
    render(<Harness steps={[step('create-user'), step('vet-datamod')]} errors={errors} />);
    expect(tile(1)).toHaveClass('has-errors');
    expect(within(tile(1)).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a']);
    expect(within(tile(2)).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['b', 'c', '+1 more']);
  });

  it('blank inputs are a to-do, not an error: one line with a count and three names, and Fill in opens the inputs', async () => {
    const errors = ['Step 1: [Web] Create ER User needs A', 'Step 1: [Web] Create ER User needs B', 'Step 1: [Web] Create ER User needs C', 'Step 1: [Web] Create ER User needs D'];
    render(<Harness steps={[step('create-user')]} errors={errors} />);
    expect(tile(1)).toHaveClass('needs-input');
    expect(tile(1)).not.toHaveClass('has-errors');
    expect(within(tile(1)).queryByRole('list')).toBeNull();
    expect(within(tile(1)).getByText('4 inputs to fill')).toBeInTheDocument();
    expect(within(tile(1)).getByText('A, B, C and 1 more')).toBeInTheDocument();
    await userEvent.click(within(tile(1)).getByRole('button', { name: 'Fill in' }));
    expect(within(tile(1)).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(tile(1)).queryByRole('button', { name: 'Fill in' })).toBeNull();
  });

  it('one blank input says "1 input to fill"; other errors on the same step still list in red', () => {
    render(<Harness steps={[step('create-user')]} errors={['Step 1: [Web] Create ER User needs A', 'Step 1: bad value']} />);
    expect(tile(1)).toHaveClass('has-errors');
    expect(within(tile(1)).getByText('1 input to fill')).toBeInTheDocument();
    expect(within(tile(1)).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['bad value']);
  });

  it('a step without errors has no error list', () => {
    render(<Harness steps={[step('create-user')]} />);
    expect(tile(1)).not.toHaveClass('has-errors');
    expect(within(tile(1)).queryByRole('list')).toBeNull();
  });

  it('the palette starts with the IF under Logic, then functions by kind of record, the kit labels first, then Other', () => {
    render(<Harness steps={[]} />);
    const heads = [...document.querySelectorAll('.palette-head')].map((h) => h.textContent);
    expect(heads).toEqual(['Logic', 'ER user', 'member', 'Other']);
  });

  describe('IF', () => {
    const ifItem = (then: DraftStep[] = [], otherwise: DraftStep[] = []): DraftItem => ({ key: 'if', kind: 'if', cond: { value: 'status', op: 'equals', to: 'NEEDS_DDE' }, then, else: otherwise });

    it('+ on the IF chip adds one at the end; dragging it onto an arrow puts it there', () => {
      render(<Harness steps={[step('create-user'), step('vet-datamod')]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Add an IF' }));
      expect(order()).toEqual(['create-user', 'vet-datamod', 'IF']);
      const chipEl = document.querySelector('.if-chip') as HTMLElement;
      fireEvent.dragStart(chipEl);
      fireEvent.dragOver(screen.getByTestId('gap-1'));
      fireEvent.drop(screen.getByTestId('gap-1'));
      expect(order()).toEqual(['create-user', 'IF', 'vet-datamod', 'IF']);
    });

    it('steps are numbered flat: the IF, its true arm, its false arm, then what follows', () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod')], [step('activate-api')]), step('view-permissions')]} />);
      expect(within(tile(2)).getByText('If')).toBeInTheDocument();
      expect(within(screen.getByLabelText('Step 2 true branch')).getByLabelText('Step 3 tile')).toHaveTextContent(/Vet/);
      expect(within(screen.getByLabelText('Step 2 false branch')).getByLabelText('Step 4 tile')).toBeInTheDocument();
      expect(tile(5)).toBeInTheDocument();
    });

    it('the condition offers what earlier steps give, and edits the IF', async () => {
      render(<Harness steps={[step('create-user'), ifItem()]} />);
      const value = screen.getByLabelText('Value') as HTMLSelectElement;
      expect([...value.options].map((o) => o.value)).toContain('reference_no');
      await userEvent.selectOptions(value, 'reference_no');
      await userEvent.selectOptions(screen.getByLabelText('Test'), 'set');
      expect(screen.queryByLabelText('Text')).toBeNull();
      expect((latest[1] as Extract<DraftItem, { kind: 'if' }>).cond).toEqual({ value: 'reference_no', op: 'set', to: 'NEEDS_DDE' });
    });

    it('a function is added to an arm from its picker, and removed with ✕', async () => {
      render(<Harness steps={[step('create-user'), ifItem()]} />);
      const trueArm = screen.getByLabelText('Step 2 true branch');
      await userEvent.selectOptions(within(trueArm).getByRole('combobox'), 'vet-datamod');
      const added = latest[1] as Extract<DraftItem, { kind: 'if' }>;
      expect(added.then.map((s) => s.fn)).toEqual(['vet-datamod']);
      expect(added.else).toEqual([]);
      await userEvent.click(screen.getByRole('button', { name: 'Remove step 3' }));
      expect((latest[1] as Extract<DraftItem, { kind: 'if' }>).then).toEqual([]);
    });

    it("the flow check's errors show on the IF and on arm steps by their flat number", () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod')])]} errors={['Step 2: the IF has no steps in either branch', 'Step 3: Vet needs DataMod ref']} />);
      expect(tile(2)).toHaveTextContent('the IF has no steps in either branch');
      expect(tile(3)).toHaveTextContent('Vet needs DataMod ref');
    });

    const arms = () => {
      const it = latest.find(isDraftIf)!;
      return { then: it.then.map((s) => s.fn), else: it.else.map((s) => s.fn) };
    };
    const laneGap = (arm: 'then' | 'else', n: number) => screen.getByTestId(`gap-if2-${arm}-${n}`);

    it('the arms show drop zones only while something that fits is dragged', () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod')])]} />);
      expect(laneGap('then', 0)).not.toHaveClass('ok');
      fireEvent.dragStart(chip('[API] Activate'), { dataTransfer });
      expect(laneGap('then', 0)).toHaveClass('ok');
      expect(laneGap('then', 1)).toHaveClass('ok');
      expect(laneGap('else', 0)).toHaveClass('ok');
      fireEvent.dragOver(laneGap('else', 0));
      expect(laneGap('else', 0)).toHaveClass('over');
      fireEvent.dragEnd(chip('[API] Activate'));
      expect(laneGap('else', 0)).not.toHaveClass('ok');
    });

    it('a function dragged from the palette drops into an arm', () => {
      render(<Harness steps={[step('member-enrol'), ifItem()]} />);
      dragTo(chip('[Admin] Vet'), laneGap('then', 0));
      expect(arms()).toEqual({ then: ['vet-datamod'], else: [] });
      dragTo(chip('[API] Activate'), laneGap('then', 0));
      expect(arms()).toEqual({ then: ['activate-api', 'vet-datamod'], else: [] });
    });

    it('an IF, from the palette or placed, never opens the arms', () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod')])]} />);
      fireEvent.dragStart(document.querySelector('.if-chip') as HTMLElement);
      expect(gap(1)).toHaveClass('ok');
      expect(laneGap('then', 0)).not.toHaveClass('ok');
      fireEvent.dragEnd(document.querySelector('.if-chip') as HTMLElement);
      fireEvent.dragStart(tile(2), { dataTransfer });
      expect(gap(0)).toHaveClass('ok');
      expect(laneGap('then', 0)).not.toHaveClass('ok');
      expect(laneGap('else', 0)).not.toHaveClass('ok');
    });

    it('a step on the main line moves into an arm', () => {
      render(<Harness steps={[step('create-user'), ifItem(), step('vet-datamod')]} />);
      dragTo(tile(3), laneGap('else', 0));
      expect(order()).toEqual(['create-user', 'IF']);
      expect(arms()).toEqual({ then: [], else: ['vet-datamod'] });
    });

    it('an arm step is draggable, fades while it moves, and moves out to the main line', () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod')]), step('view-permissions')]} />);
      expect(tile(3)).toHaveAttribute('draggable', 'true');
      fireEvent.dragStart(tile(3), { dataTransfer });
      expect(tile(3)).toHaveClass('moving');
      expect(laneGap('then', 0)).not.toHaveClass('ok');
      expect(laneGap('then', 1)).not.toHaveClass('ok');
      fireEvent.dragOver(gap(3));
      fireEvent.drop(gap(3));
      expect(order()).toEqual(['create-user', 'IF', 'view-permissions', 'vet-datamod']);
      expect(arms()).toEqual({ then: [], else: [] });
    });

    it('an arm step moves to the other arm, and within its own', () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod'), step('activate-api')])]} />);
      dragTo(tile(4), laneGap('then', 0));
      expect(arms()).toEqual({ then: ['activate-api', 'vet-datamod'], else: [] });
      dragTo(tile(3), laneGap('else', 0));
      expect(arms()).toEqual({ then: ['vet-datamod'], else: ['activate-api'] });
    });

    it('dragging an arm step does not drag its IF', () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod')])]} />);
      fireEvent.dragStart(tile(3), { dataTransfer });
      expect(tile(2)).not.toHaveClass('moving');
    });

    it('removing the IF removes its arms', async () => {
      render(<Harness steps={[step('create-user'), ifItem([step('vet-datamod')])]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
      expect(order()).toEqual(['create-user']);
    });
  });

  describe('saved flows', () => {
    const enrolVet: Preset = {
      file: 'config/flows/member-enrolment.flow.json',
      label: 'Member enrolment',
      summary: 'Enrol → If status is NEEDS_DDE: Vet',
      spec: { steps: [{ function: 'member-enrol', values: { mobile: '91234567' } }, { if: { value: 'status', equals: 'NEEDS_DDE' }, then: [{ function: 'vet-datamod' }] }] },
    };
    const twoSteps: Preset = { file: 'config/flows/er.flow.json', label: 'ER pair', summary: 'Create → Vet', spec: { steps: [{ function: 'create-user' }, { function: 'vet-datamod' }] } };
    const flowChip = (label: string) => screen.getByRole('button', { name: `Add the steps of ${label}` }).closest('.fn-chip') as HTMLElement;
    const ifOf = () => latest.find(isDraftIf)!;

    it('no saved flows: no group; with some, a "Saved flows" group lists each, its summary as the tooltip', () => {
      const { unmount } = render(<Harness steps={[]} />);
      expect(screen.queryByText('Saved flows')).toBeNull();
      unmount();
      render(<Harness steps={[]} flows={[enrolVet, twoSteps]} />);
      expect(screen.getByText('Saved flows')).toBeInTheDocument();
      expect(flowChip('Member enrolment')).toHaveAttribute('title', 'Enrol → If status is NEEDS_DDE: Vet');
      expect(flowChip('ER pair')).toHaveAttribute('draggable', 'true');
    });

    it('+ copies its steps to the end, typed values and IF arms included', async () => {
      render(<Harness steps={[step('member-register')]} flows={[enrolVet]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Add the steps of Member enrolment' }));
      expect(order()).toEqual(['member-register', 'member-enrol', 'IF']);
      expect((latest[1] as DraftStep).values).toEqual({ mobile: '91234567' });
      expect(ifOf().cond).toEqual({ value: 'status', op: 'equals', to: 'NEEDS_DDE' });
      expect(ifOf().then.map((s) => s.fn)).toEqual(['vet-datamod']);
    });

    it('dragged onto an arrow, its steps go in there', () => {
      render(<Harness steps={[step('create-user'), step('activate-api')]} flows={[twoSteps]} />);
      dragTo(flowChip('ER pair'), gap(1));
      expect(order()).toEqual(['create-user', 'create-user', 'vet-datamod', 'activate-api']);
    });

    it('each copy is its own: dropping twice gives steps with different keys', async () => {
      render(<Harness steps={[]} flows={[twoSteps]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Add the steps of ER pair' }));
      await userEvent.click(screen.getByRole('button', { name: 'Add the steps of ER pair' }));
      expect(new Set(latest.map((s) => s.key)).size).toBe(4);
    });

    it('a flow without an IF drops into an arm; one with an IF never opens the arms', () => {
      const branch: DraftItem = { key: 'if', kind: 'if', cond: { value: 'status', op: 'set', to: '' }, then: [], else: [] };
      render(<Harness steps={[step('member-enrol'), branch]} flows={[enrolVet, twoSteps]} />);
      fireEvent.dragStart(flowChip('Member enrolment'), { dataTransfer });
      expect(screen.getByTestId('gap-if2-then-0')).not.toHaveClass('ok');
      expect(gap(0)).toHaveClass('ok');
      fireEvent.dragEnd(flowChip('Member enrolment'));
      dragTo(flowChip('ER pair'), screen.getByTestId('gap-if2-else-0'));
      expect(ifOf().else.map((s) => s.fn)).toEqual(['create-user', 'vet-datamod']);
    });
  });

  it('a [tag] shows as a badge, and steps and chips with the same tag share a colour', () => {
    render(<Harness steps={[step('create-user')]} />);
    expect(within(tile(1)).getByText('Web')).toHaveClass('tag');
    const tone = [...tile(1).classList].find((c) => c.startsWith('tone-'));
    expect(tone).toBeTruthy();
    expect(chip('[Web] Register')).toHaveClass(tone!);
  });

  it("the open step's inputs have no second heading or Remove", async () => {
    render(<Harness steps={[step('vet-datamod')]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Inputs' }));
    expect(screen.getAllByRole('button', { name: 'Remove step 1' })).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Step 1' })).queryByRole('heading')).toBeNull();
  });
});
