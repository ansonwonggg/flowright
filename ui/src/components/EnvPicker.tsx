import { useChooseEnvironment, useEnvironments, useLive } from '../queries.ts';
import { useDialog } from './Dialog.tsx';

const NONE = '';

/**
 * The header's environment switch: which `.env.<name>.local` the next run uses on top of `.env.local`.
 * Hidden when the repo has no environment files and none is active. Locked while a run goes, since a run
 * keeps the environment it started in; the server refuses a switch then too.
 */
export const EnvPicker = () => {
  const { data } = useEnvironments();
  const { data: live } = useLive();
  const choose = useChooseEnvironment();
  const { notify, dialog } = useDialog();
  if (!data || (!data.environments.length && !data.active)) return null;
  const onChange = async (value: string) => {
    try {
      await choose.mutateAsync(value === NONE ? null : value);
    } catch (e) {
      await notify('Could not switch the environment', (e as Error).message);
    }
  };
  return (
    <label className="env-picker" title={live ? 'A run is going; switch after it ends.' : 'The environment the next run uses'}>
      {dialog}
      <span>Env</span>
      <select aria-label="Environment" value={data.active ?? NONE} disabled={Boolean(live) || choose.isPending} onChange={(e) => onChange(e.target.value)}>
        <option value={NONE}>none (.env.local)</option>
        {data.environments.map((e) => (
          <option key={e.name} value={e.name}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
};
