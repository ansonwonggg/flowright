import { Link } from 'react-router-dom';
import { targetOf } from '../lib/environment.ts';
import { useStopRun } from '../queries.ts';
import { useDialog } from './Dialog.tsx';
import { EnvChip, ReportLink, StatusPill } from './bits.tsx';

/**
 * The header a function run and a flow run share: back link, title, status, then Run again, the report
 * link and Stop, in that order. Stop asks first, and stops whatever is live, since runs go one at a time.
 *
 * @param back - where the back link goes and what it says, e.g. `{ to: '/history', label: 'History' }`.
 * @param status - a run or flow status; `stopped`, `waiting` and `skipped` take the run colours.
 * @param statusTestId - lets tests find the status pill.
 * @param rerunTo - where Run again goes; no button when left out.
 * @param reportOf - the run whose kept Playwright report to link to; no link when left out.
 * @param stoppable - shows Stop.
 * @param env - the environment the run used, shown as a chip and named in the Stop question; none when left out.
 * @param children - extra controls, placed before the buttons, e.g. a view switch.
 */
export const RunHead = ({
  back,
  title,
  status,
  statusTestId,
  rerunTo,
  reportOf,
  stoppable,
  env,
  children,
}: {
  back: { to: string; label: string };
  title: React.ReactNode;
  status: string;
  statusTestId: string;
  rerunTo?: string;
  reportOf?: string;
  stoppable: boolean;
  env?: string;
  children?: React.ReactNode;
}) => {
  const stop = useStopRun();
  const { confirm, notify, dialog } = useDialog();
  const onStop = async () => {
    if (!(await confirm({ title: 'Stop this run?', body: `Whatever ${targetOf(env)} already accepted stays there.`, ok: 'Stop', tone: 'danger' }))) return;
    try {
      await stop.mutateAsync();
    } catch (e) {
      await notify('Could not stop the run', (e as Error).message);
    }
  };
  return (
    <>
      {dialog}
      <Link className="crumb" to={back.to}>
        ← {back.label}
      </Link>
      <div className="pagehead">
        <h1>{title}</h1>
        <StatusPill status={status} testId={statusTestId} />
        {env && <EnvChip env={env} />}
        <span className="spacer" />
        {children}
        {rerunTo && (
          <Link className="btn small" to={rerunTo}>
            Run again
          </Link>
        )}
        {reportOf && <ReportLink runId={reportOf} />}
        {stoppable && (
          <button type="button" className="btn danger small" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </>
  );
};
