import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RunBar, type RunBarProps } from './RunBar.tsx';

const show = (props: Partial<RunBarProps> = {}) =>
  render(
    <RunBar problems={[]} checking={false} ready="Ready to run" headed={false} onHeaded={() => {}} {...props}>
      <button type="button">Run</button>
    </RunBar>,
  );

describe('RunBar', () => {
  it('no problems: says ready, with its hint, and shows no notes box', () => {
    show({ readyHint: '2 input(s) come from the record.' });
    expect(screen.getByRole('region', { name: 'Run' })).toHaveTextContent('✓ Ready to run');
    expect(screen.getByText(/2 input\(s\) come from the record/)).toBeInTheDocument();
    expect(document.querySelector('.runbar-notes')).toBeNull();
  });

  it('checking: says so, and hides the ready hint', () => {
    show({ checking: true, readyHint: 'from the record' });
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    expect(screen.queryByText(/from the record/)).toBeNull();
  });

  it('problems win over checking: counts them and lists each under "Fix before running"', () => {
    show({ checking: true, problems: ['company is required', 'mobile is required'] });
    expect(screen.getByText('2 to fix')).toBeInTheDocument();
    expect(screen.getByText('Fix before running')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['company is required', 'mobile is required']);
    expect(screen.queryByText(/Ready to run/)).toBeNull();
  });

  it('shows every note above the bar', () => {
    show({ notes: ['"Create" is running.', <b key="e">.env.local is missing</b>] });
    expect(screen.getByText('"Create" is running.')).toBeInTheDocument();
    expect(screen.getByText('.env.local is missing')).toBeInTheDocument();
  });

  it('the browser toggle reports the new state and reflects the given one', async () => {
    const onHeaded = vi.fn();
    const { rerender } = show({ onHeaded });
    const box = screen.getByRole('checkbox', { name: 'Show the browser while it runs' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onHeaded).toHaveBeenCalledWith(true);
    rerender(
      <RunBar problems={[]} checking={false} ready="Ready to run" headed onHeaded={onHeaded}>
        <button type="button">Run</button>
      </RunBar>,
    );
    expect(box).toBeChecked();
  });

  it('renders the given buttons', () => {
    show();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });
});
