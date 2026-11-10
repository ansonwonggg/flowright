import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fn, META } from '../lib/fixtures.test-utils.ts';
import { flowOf, type DraftStep } from '../lib/flowDraft.ts';
import { DragSteps } from './DragSteps.tsx';

const step = (fn: string): DraftStep => ({ key: fn, fn, values: {}, forms: {} });

let latest: DraftStep[] = [];
const Harness = ({ steps, errors = [] }: { steps: DraftStep[]; errors?: string[] }) => {
  const [all, setAll] = useState(steps);
  latest = all;
  return <DragSteps steps={all} flow={flowOf(all, META.fields)} meta={META} errors={errors} onSteps={setAll} />;
};

const order = () => latest.map((s) => s.fn);
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
    expect(latest[0].values).toEqual({ reference_no: 'D' });
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

  it('a step without errors has no error list', () => {
    render(<Harness steps={[step('create-user')]} />);
    expect(tile(1)).not.toHaveClass('has-errors');
    expect(within(tile(1)).queryByRole('list')).toBeNull();
  });

  it('the palette is grouped by kind of record, the kit labels first, then Other', () => {
    render(<Harness steps={[]} />);
    const heads = [...document.querySelectorAll('.palette-head')].map((h) => h.textContent);
    expect(heads).toEqual(['ER user', 'member', 'Other']);
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
