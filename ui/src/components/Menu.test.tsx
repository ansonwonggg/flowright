import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItem } from './Menu.tsx';

const show = (items: MenuItem[]) =>
  render(
    <MemoryRouter>
      <p>outside</p>
      <Menu label="Step 1 options" items={items} />
    </MemoryRouter>,
  );
const button = () => screen.getByRole('button', { name: 'Step 1 options' });

describe('Menu', () => {
  it('closed at first; the button says it opens a menu', () => {
    show([{ label: 'Input', onSelect: () => {} }]);
    expect(button()).toHaveAttribute('aria-haspopup', 'menu');
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on click, focusing the first entry; clicking the button again closes it', async () => {
    show([{ label: 'Input', onSelect: () => {} }]);
    await userEvent.click(button());
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Input' })).toHaveFocus();
    await userEvent.click(button());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('choosing an action calls it and closes', async () => {
    const onSelect = vi.fn();
    show([{ label: 'Input', onSelect }]);
    await userEvent.click(button());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Input' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('an on/off entry shows its state and a tick when on', async () => {
    show([
      { label: 'Input', checked: true, onSelect: () => {} },
      { label: 'Log', checked: false, onSelect: () => {} },
    ]);
    await userEvent.click(button());
    expect(screen.getByRole('menuitemcheckbox', { name: '✓Input' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Log' })).toHaveAttribute('aria-checked', 'false');
  });

  it('a link entry goes to its page', async () => {
    show([{ label: 'Open in History', to: '/run/r1' }]);
    await userEvent.click(button());
    expect(screen.getByRole('menuitem', { name: 'Open in History' })).toHaveAttribute('href', '/run/r1');
  });

  it('Escape and a click outside close it; a click inside does not', async () => {
    show([{ label: 'Input', onSelect: () => {} }]);
    await userEvent.click(button());
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(button());
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('no entries: nothing at all', () => {
    show([]);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
