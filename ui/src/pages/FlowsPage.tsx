import { Link, useNavigate } from 'react-router-dom';
import type { FlowRun, Preset } from '../api.ts';
import { FnTitle } from '../components/FnTitle.tsx';
import { when } from '../lib/format.ts';
import { useFlowRuns, usePresets } from '../queries.ts';
import { pillOf } from './FlowRunPage.tsx';

/** Cards for the saved flows, plus one to build a new flow. */
export const FlowCards = ({ flows }: { flows: Preset[] }) => (
  <div className="cards">
    {flows.map((f) => (
      <Link key={f.file} className="flowcard big" to={`/flow-builder?preset=${encodeURIComponent(f.file)}`}>
        <div className="t">{f.label}</div>
        <div className="chain">
          {f.summary.split(' → ').map((step, i) => (
            <span key={i} className="chain-item">
              {i > 0 && <span className="arr"> → </span>}
              <span className="chain-step-name">
                <FnTitle title={step} />
              </span>
            </span>
          ))}
        </div>
      </Link>
    ))}
    <Link className="flowcard big new" to="/flow-builder">
      <div className="t">+ New flow</div>
      <div className="d">Join functions one after another</div>
    </Link>
  </div>
);

const passedSteps = (run: FlowRun) => `${run.steps.filter((s) => s.status === 'passed').length}/${run.steps.length}`;

export const FlowsPage = () => {
  const navigate = useNavigate();
  const { data: presets } = usePresets();
  const { data: runs = [] } = useFlowRuns();
  return (
    <div className="wide-page">
      <h1>Flows</h1>
      <p className="lead">Functions joined one after another on one record. Each step passes what it made on to the next.</p>
      <FlowCards flows={presets?.flows ?? []} />
      <h2>Recent flow runs</h2>
      {runs.length ? (
        <section className="tight">
          <table>
            <thead>
              <tr>
                <th>Flow</th>
                <th>Result</th>
                <th>Steps passed</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="click" onClick={() => navigate(`/flow-run/${r.id}`)}>
                  <td className="strong">{r.name}</td>
                  <td>
                    <span className={`pill ${pillOf(r.status)}`}>{r.status}</span>
                  </td>
                  <td className="muted">{passedSteps(r)}</td>
                  <td className="muted nowrap">{when(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <div className="muted">No flow has run yet.</div>
      )}
    </div>
  );
};
