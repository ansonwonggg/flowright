import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SuggestInput } from './SuggestInput.tsx';

const SCHEMES = ['BCT (MPF) Industry Choice', 'BCT (MPF) Pro Choice', 'BEA (MPF) Industry Scheme', 'Sun Life MPF Basic Scheme'];

const Harness = ({ initial = '', suggestions = SCHEMES, spy = vi.fn(), type }: { initial?: string; suggestions?: string[]; spy?: (v: string) => void; type?: 'text' | 'password' }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="s">Scheme</label>
      <SuggestInput
        id="s"
        value={value}
        suggestions={suggestions}
        type={type}
        placeholder="pick one"
        onChange={(v) => {
          setValue(v);
          spy(v);
        }}
      />
      <button type="button">elsewhere</button>
    </>
  );
};

const input = () => screen.getByRole('combobox', { name: 'Scheme' });
const shown = () => screen.queryAllByRole('option').map((o) => o.textContent);

describe('SuggestInput', () => {
  it('starts closed', () => {
    render(<Harness />);
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('clicking an empty box shows every suggestion', async () => {
    render(<Harness />);
    await userEvent.click(input());
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(shown()).toEqual(SCHEMES);
  });

  it('clicking a box that already holds a suggestion still shows every suggestion, the current one selected', async () => {
    render(<Harness initial="BCT (MPF) Pro Choice" />);
    await userEvent.click(input());
    expect(shown()).toEqual(SCHEMES);
    expect(screen.getByRole('option', { name: 'BCT (MPF) Pro Choice' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'BCT (MPF) Industry Choice' })).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking a box holding text that matches nothing still shows every suggestion', async () => {
    render(<Harness initial="Old renamed scheme" />);
    await userEvent.click(input());
    expect(shown()).toEqual(SCHEMES);
  });

  it('the toggle button shows every suggestion, then hides them', async () => {
    render(<Harness initial="BCT (MPF) Pro Choice" />);
    const toggle = screen.getByRole('button', { name: 'Show all suggestions' });
    await userEvent.click(toggle);
    expect(shown()).toEqual(SCHEMES);
    expect(input()).toHaveFocus();
    await userEvent.click(toggle);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('typing narrows the list to suggestions containing the text, ignoring case', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await userEvent.type(input(), 'industry');
    expect(shown()).toEqual(['BCT (MPF) Industry Choice', 'BEA (MPF) Industry Scheme']);
    expect(spy).toHaveBeenLastCalledWith('industry');
  });

  it('typing text that matches nothing closes the list', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'zzz');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('typed text that matches nothing is kept as the value', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await userEvent.type(input(), 'zzz');
    await userEvent.tab();
    expect(input()).toHaveValue('zzz');
    expect(spy).toHaveBeenLastCalledWith('zzz');
  });

  it('clearing typed text shows every suggestion again', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'Sun');
    expect(shown()).toEqual(['Sun Life MPF Basic Scheme']);
    await userEvent.clear(input());
    expect(shown()).toEqual(SCHEMES);
  });

  it('clicking an option sets the value, closes the list and keeps focus in the box', async () => {
    const spy = vi.fn();
    render(<Harness initial="BCT (MPF) Pro Choice" spy={spy} />);
    await userEvent.click(input());
    await userEvent.click(screen.getByRole('option', { name: 'BEA (MPF) Industry Scheme' }));
    expect(spy).toHaveBeenLastCalledWith('BEA (MPF) Industry Scheme');
    expect(input()).toHaveValue('BEA (MPF) Industry Scheme');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input()).toHaveFocus();
  });

  it('ArrowDown opens the full list on the current value; arrows move, Enter picks', async () => {
    const spy = vi.fn();
    render(<Harness initial="BCT (MPF) Pro Choice" spy={spy} />);
    input().focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(shown()).toEqual(SCHEMES);
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'BCT (MPF) Pro Choice' }).id);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(spy).toHaveBeenLastCalledWith('Sun Life MPF Basic Scheme');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('arrows stop at the ends of the list', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    input().focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: SCHEMES[0] }).id);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    expect(spy).toHaveBeenLastCalledWith(SCHEMES[0]);
    input().focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(spy).toHaveBeenLastCalledWith(SCHEMES[3]);
  });

  it('ArrowUp on a closed box opens it on the last suggestion', async () => {
    render(<Harness />);
    input().focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: SCHEMES[3] }).id);
  });

  it('Enter with nothing highlighted leaves the value alone', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await userEvent.type(input(), 'Sun{Enter}');
    expect(spy).toHaveBeenLastCalledWith('Sun');
    expect(input()).toHaveValue('Sun');
  });

  it('Escape closes the list without changing the value', async () => {
    const spy = vi.fn();
    render(<Harness initial="BCT (MPF) Pro Choice" spy={spy} />);
    await userEvent.click(input());
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaving the box closes the list', async () => {
    render(<Harness />);
    await userEvent.click(input());
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('no suggestions: a plain text box, no toggle, no list', async () => {
    render(<Harness suggestions={[]} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all suggestions' })).not.toBeInTheDocument();
    const box = screen.getByLabelText('Scheme');
    expect(box).toHaveAttribute('type', 'text');
    await userEvent.type(box, 'x');
    expect(box).toHaveValue('x');
  });

  it('password type is kept, with or without suggestions', () => {
    const { unmount } = render(<Harness type="password" />);
    expect(screen.getByLabelText('Scheme')).toHaveAttribute('type', 'password');
    unmount();
    render(<Harness type="password" suggestions={[]} />);
    expect(screen.getByLabelText('Scheme')).toHaveAttribute('type', 'password');
  });

  it('shows the placeholder and turns off browser autofill', () => {
    render(<Harness />);
    expect(input()).toHaveAttribute('placeholder', 'pick one');
    expect(input()).toHaveAttribute('autocomplete', 'off');
  });

  it('repeated suggestions show once', async () => {
    render(<Harness suggestions={['A', 'B', 'A']} />);
    await userEvent.click(input());
    expect(shown()).toEqual(['A', 'B']);
  });
});
