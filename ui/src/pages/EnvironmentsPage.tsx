import { useState } from 'react';
import type { EnvironmentFile, EnvironmentVar, Environments } from '../api.ts';
import { useEnvironments } from '../queries.ts';

const SHELL_HINT = "Set in the shell that started the app, so it wins over the files.";

const Value = ({ v }: { v: EnvironmentVar }) => {
  if (!v.set) return <span className="chip warn">empty</span>;
  if (v.secret) return <span className="muted">•••• set</span>;
  return <span className="mono">{v.value}</span>;
};

const VarTable = ({ vars }: { vars: EnvironmentVar[] }) =>
  vars.length ? (
    <table className="env-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th>From</th>
        </tr>
      </thead>
      <tbody>
        {vars.map((v) => (
          <tr key={v.name}>
            <td className="mono nowrap">{v.name}</td>
            <td className="env-value">
              <Value v={v} />
            </td>
            <td className="nowrap">
              <span className={v.from === 'shell' ? 'chip warn' : 'chip'} title={v.from === 'shell' ? SHELL_HINT : undefined}>
                {v.from}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <div className="empty">No vars in these files.</div>
  );

const shownFile = (data: Environments, name: string | null): EnvironmentFile & { name: string | null } => {
  const env = data.environments.find((e) => e.name === name);
  return env ?? { ...data.shared, name: null };
};

/**
 * What each environment holds, read-only: every var of `.env.local` and `.env.<name>.local`, with secrets
 * hidden and the file each value comes from. Opens on the active environment.
 */
export const EnvironmentsPage = () => {
  const { data, error, isPending } = useEnvironments();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  if (isPending) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty">{error.message}</div>;
  const shown = shownFile(data, picked === undefined ? data.active : picked);
  const tabs: (string | null)[] = [...data.environments.map((e) => e.name), null];
  return (
    <div className="focus wide">
      <h1>Environments</h1>
      <p className="lead">
        Each <code>.env.&lt;name&gt;.local</code> in the repo root is an environment, used on top of <code>.env.local</code>. Edit the files in your editor;
        the app reads them again on every run. Switch the one runs use from the top bar.
      </p>
      {!data.environments.length && (
        <p className="box">
          No environments yet, so runs use <code>.env.local</code> alone. Add <code>.env.dev.local</code>, <code>.env.uat.local</code>… with the values that
          differ (hosts, accounts) and keep what they share in <code>.env.local</code>.
        </p>
      )}
      <div className="filters">
        <div className="seg" role="tablist" aria-label="Environment to view">
          {tabs.map((name) => (
            <button key={name ?? ''} type="button" role="tab" aria-selected={shown.name === name} className={shown.name === name ? 'on' : ''} onClick={() => setPicked(name)}>
              {name ?? '.env.local only'}
              {data.active === name && <span className="env-active"> · in use</span>}
            </button>
          ))}
        </div>
      </div>
      <section className="tight env-section">
        <div className="card-head">
          <h2 className="sub">{shown.name ? `${shown.file} over ${data.shared.file}` : data.shared.file}</h2>
        </div>
        <VarTable vars={shown.vars} />
      </section>
    </div>
  );
};
