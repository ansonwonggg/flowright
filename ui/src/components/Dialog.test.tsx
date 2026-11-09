import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useDialog, type Ask } from './Dialog.tsx';

const results: unknown[] = [];
const Harness = ({ ask, second }: { ask: Ask; second?: Ask }) => {
  const { confirm, notify, dialog } = useDialog();
  return (
    <>
      <button type="button" onClick={() => confirm(ask).then((ok) => results.push(ok))}>
        ask
      </button>
      <button type="button" onClick={() => second && confirm(second).then((ok) => results.push(`second:${ok}`))}>
        again
      </button>
      <button type="button" onClick={() => notify('Failed', 'boom').then(() => results.push('dismissed'))}>
        tell
      </button>
      {dialog}
    </>
  );
};

const open = async (ask: Ask, name = 'ask', second?: Ask) => {
  results.length = 0;
  render(<Harness ask={ask} second={second} />);
  await userEvent.click(screen.getByRole('button', { name }));
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('useDialog', () => {
  it('nothing is shown until asked', () => {
    render(<Harness ask={{ title: 'Start?' }} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title as its name, the body, and default buttons; the confirming one has focus', async () => {
    await open({ title: 'Start?', body: <ol><li>step one</li></ol> });
    const dialog = screen.getByRole('dialog', { name: 'Start?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('step one');
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('OK resolves true and closes', async () => {
    await open({ title: 'Start?', ok: 'Start' });
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    expect(results).toEqual([true]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Cancel, Escape and a click outside resolve false', async () => {
    await open({ title: 'Start?', cancel: 'Not now' });
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    await settle();
    expect(results).toEqual([false, false, false]);
  });

  it('a click inside the box does not close it', async () => {
    await open({ title: 'Start?' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('danger colours the confirming button', async () => {
    await open({ title: 'Stop?', tone: 'danger' });
    expect(screen.getByRole('button', { name: 'OK' })).toHaveClass('danger');
  });

  it('notify has only OK; OK or Escape dismisses it', async () => {
    await open({ title: 'x' }, 'tell');
    expect(screen.getByRole('dialog', { name: 'Failed' })).toHaveTextContent('boom');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await userEvent.click(screen.getByRole('button', { name: 'tell' }));
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(results).toEqual(['dismissed', 'dismissed']);
  });

  it('asking again replaces the open dialog and cancels the first', async () => {
    await open({ title: 'First' }, 'ask', { title: 'Second' });
    fireEvent.click(screen.getByRole('button', { name: 'again' }));
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await settle();
    expect(results).toEqual([false, 'second:true']);
  });
});
