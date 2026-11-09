import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TestView } from '../../../src/index.ts';
import type { Failure } from '../api.ts';
import { Timeline } from './Timeline.tsx';

const test = (over: Partial<TestView> = {}): TestView => ({ title: 'flow', status: 'passed', startedAt: 0, duration: 65_000, steps: [], ...over });
const failure: Failure = { type: 'failure', test: 'flow', step: '2 SUBMIT', kind: 'portal', title: 'DEV returned an error', hint: 'Try again later.', error: 'Sorry!' };

describe('Timeline', () => {
  it('shows tests and two levels of steps with durations', () => {
    render(
      <Timeline
        tests={[test({ steps: [{ title: '1 PREPARE', status: 'passed', startedAt: 0, duration: 3_000, steps: [{ title: 'fill', status: 'passed', startedAt: 0, duration: 1_000, steps: [] }] }] })]}
        failures={[]}
        status="passed"
        live={false}
        now={0}
      />,
    );
    expect(screen.getByText('flow')).toBeInTheDocument();
    expect(screen.getByText('1m05s')).toBeInTheDocument();
    expect(screen.getByText('1 PREPARE')).toBeInTheDocument();
    expect(screen.getByText('fill')).toBeInTheDocument();
    expect(screen.getAllByLabelText('passed')).toHaveLength(3);
  });

  it('a running step counts up from now while live', () => {
    render(<Timeline tests={[test({ status: 'running', startedAt: 1_000, duration: undefined, steps: [{ title: 'wait', status: 'running', startedAt: 1_000, steps: [] }] })]} failures={[]} status="running" live now={43_000} />);
    expect(screen.getAllByText('42s')).toHaveLength(2);
    expect(screen.getAllByLabelText('running')).toHaveLength(2);
  });

  it('setup logins collapse onto one line', () => {
    render(<Timeline tests={[test({ title: 'log in as inputter1' }), test({ title: 'log in as inputter2' }), test()]} failures={[]} status="passed" live={false} now={0} />);
    expect(screen.getByText(/log in as inputter1/).closest('.setup')).toHaveTextContent('log in as inputter2');
  });

  it('explains each failure with its step and error', () => {
    render(<Timeline tests={[test({ status: 'failed' })]} failures={[failure]} status="failed" live={false} now={0} />);
    expect(screen.getByText('✗ DEV returned an error')).toBeInTheDocument();
    expect(screen.getByText('flow → 2 SUBMIT')).toBeInTheDocument();
    expect(screen.getByText('Try again later.')).toBeInTheDocument();
    expect(screen.getByText('Sorry!')).toBeInTheDocument();
  });

  it('a failure without a step or error leaves them out', () => {
    const { container } = render(<Timeline tests={[]} failures={[{ ...failure, step: undefined, error: '' }]} status="failed" live={false} now={0} />);
    expect(screen.getByText('flow')).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('live with no tests yet says Playwright is starting', () => {
    render(<Timeline tests={[]} failures={[]} status="running" live now={0} />);
    expect(screen.getByText('Starting Playwright…')).toBeInTheDocument();
  });

  it('a finished run with no tests points at the log, and says how it ended', () => {
    render(<Timeline tests={[]} failures={[]} status="interrupted" live={false} now={0} />);
    expect(screen.getByText('No tests ran. See the log below.')).toBeInTheDocument();
    expect(screen.getByText(/ended as "interrupted" without a failed test/)).toBeInTheDocument();
  });

  it('a passed run with no failures shows no warning', () => {
    render(<Timeline tests={[test()]} failures={[]} status="passed" live={false} now={0} />);
    expect(screen.queryByText(/without a failed test/)).not.toBeInTheDocument();
  });
});
