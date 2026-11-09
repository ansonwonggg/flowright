import type { StepView, TestView } from '../../../src/index.ts';
import type { Failure, ShownStatus } from '../api.ts';
import { duration } from '../lib/format.ts';
import { FnTitle } from './FnTitle.tsx';

const Icon = ({ status }: { status: string }) => {
  if (status === 'running')
    return (
      <span className="icon running" aria-label="running">
        <span className="spin">◐</span>
      </span>
    );
  if (status === 'passed') return <span className="icon passed" aria-label="passed">✓</span>;
  if (status === 'skipped') return <span className="icon">–</span>;
  return <span className="icon failed" aria-label={status}>✗</span>;
};

const took = (item: { status: string; startedAt: number; duration?: number }, live: boolean, now: number) =>
  item.status === 'running' && live ? duration(now - item.startedAt) : duration(item.duration);

const Step = ({ step, live, now }: { step: StepView; live: boolean; now: number }) => (
  <>
    <div className="row">
      <Icon status={step.status} />
      <span className="t">{step.title}</span>
      <span className="d">{took(step, live, now)}</span>
    </div>
    {step.steps.length > 0 && (
      <div className="steps">
        {step.steps.map((s, i) => (
          <Step key={i} step={s} live={live} now={now} />
        ))}
      </div>
    )}
  </>
);

/**
 * A run's tests and named steps, two levels deep, then each failure explained.
 *
 * Setup logins (`log in as …`) collapse onto one muted line. While `live`, running steps count up
 * from `now`. A finished run that failed without a failed test says to read the log.
 */
export type TimelineProps = { tests: TestView[]; failures: Failure[]; status: ShownStatus; live: boolean; now: number };

export const Timeline = ({ tests, failures, status, live, now }: TimelineProps) => {
  const isSetup = (t: TestView) => /^log in as /.test(t.title);
  const setup = tests.filter(isSetup);
  return (
    <>
      {setup.length > 0 && (
        <div className="setup">
          {setup.map((t, i) => (
            <span key={i} className="setup-item">
              <Icon status={t.status} /> {t.title}
            </span>
          ))}
        </div>
      )}
      {tests
        .filter((t) => !isSetup(t))
        .map((t, i) => (
          <div key={i}>
            <div className="row testrow">
              <Icon status={t.status} />
              <span className="t">
                <FnTitle title={t.title} />
              </span>
              <span className="d">{took(t, live, now)}</span>
            </div>
            {t.steps.length > 0 && (
              <div className="steps">
                {t.steps.map((s, j) => (
                  <Step key={j} step={s} live={live} now={now} />
                ))}
              </div>
            )}
          </div>
        ))}
      {tests.length === 0 && <div className="muted">{live ? 'Starting Playwright…' : 'No tests ran. See the log below.'}</div>}
      {failures.map((f, i) => (
        <div key={i} className="failure">
          <div className="ft">✗ {f.title}</div>
          <div className="muted">
            {f.test}
            {f.step ? ` → ${f.step}` : ''}
          </div>
          <div className="gap">{f.hint}</div>
          {f.error && <pre>{f.error}</pre>}
        </div>
      ))}
      {!live && failures.length === 0 && status !== 'passed' && (
        <div className="box bad gap-top">The run ended as "{status}" without a failed test. The log below says why.</div>
      )}
    </>
  );
};
