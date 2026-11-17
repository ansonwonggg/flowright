import type { FlowRun, FlowRunStep } from '../api.ts';
import { targetOf } from '../lib/environment.ts';
import { useRetryFlow } from '../queries.ts';
import { useDialog } from './Dialog.tsx';

const ended = (s: FlowRunStep) => s.status === 'failed' || s.status === 'stopped';

const doneBefore = (index: number) => {
  if (index === 0) return '';
  if (index === 1) return 'Step 1 passed and stays as it is. ';
  return `Steps 1–${index} passed and stay as they are. `;
};

/**
 * "Retry step N" for a failed or stopped flow run: asks first, then resumes the same run from the step that
 * ended it. Renders nothing for a run that is going or passed. A refused retry is shown in a dialog.
 *
 * @param run - the flow run to retry.
 * @param onRetried - called after the server accepted the retry, e.g. to open the flow run page.
 */
export const RetryButton = ({ run, onRetried }: { run: FlowRun; onRetried?: () => void }) => {
  const retry = useRetryFlow();
  const { confirm, notify, dialog } = useDialog();
  const index = run.status === 'failed' || run.status === 'stopped' ? run.steps.findIndex(ended) : -1;
  if (index < 0) return dialog;
  const n = index + 1;
  const step = run.steps[index];
  const onRetry = async () => {
    const ok = await confirm({
      title: `Retry from step ${n}?`,
      body: (
        <>
          <p>
            {doneBefore(index)}Step {n}, {step.title}, runs again with the same inputs, then the rest of the flow.
          </p>
          {step.error && <div className="box bad">{step.error}</div>}
          <p>
            If step {n} got as far as submitting before it ended, {targetOf(run.env)} may already hold what it made, and running it again can make a
            second one. Check Records or the site first.
          </p>
        </>
      ),
      ok: 'Retry',
    });
    if (!ok) return;
    try {
      await retry.mutateAsync(run.id);
      onRetried?.();
    } catch (e) {
      await notify('Could not retry', (e as Error).message);
    }
  };
  return (
    <>
      {dialog}
      <button type="button" className="btn small primary" onClick={onRetry} disabled={retry.isPending}>
        Retry step {n}
      </button>
    </>
  );
};
