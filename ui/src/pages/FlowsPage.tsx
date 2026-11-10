import { Link, useNavigate } from 'react-router-dom';
import { isIf } from '../../../src/flow.ts';
import type { FlowRun, Preset } from '../api.ts';
import { FnTitle } from '../components/FnTitle.tsx';
import { Grouped } from '../components/Grouped.tsx';
import { groupOf } from '../lib/flowDraft.ts';
import { when } from '../lib/format.ts';
import { groupItems } from '../lib/groups.ts';
import { useFlowRuns, usePresets } from '../queries.ts';
import { pillOf } from './FlowRunPage.tsx';

const FlowCard = ({ flow }: { flow: Preset }) => (
  <Link className="flowcard big" to={`/flow-builder?preset=${encodeURIComponent(flow.file)}`}>
    <div className="t">{flow.label}</div>
    <div className="chain">
      {flow.summary.split(' → ').map((step, i) => (
        <span key={i} className="chain-item">
          {i > 0 && <span className="arr"> → </span>}
          <span className="chain-step-name">
            <FnTitle title={step} />
          </span>
        </span>
      ))}
    </div>
  </Link>
);

/** Cards for the saved flows, under a heading per flow `group` when any has one, then a card to build a new flow. */
export const FlowCards = ({ flows }: { flows: Preset[] }) => (
  <Grouped
    groups={groupItems(flows, (f) => groupOf(f.spec))}
    listClass="cards"
    render={(f) => <FlowCard key={f.file} flow={f} />}
    after={
      <Link className="flowcard big new" to="/flow-builder">
        <div className="t">+ New flow</div>
        <div className="d">Join functions one after another</div>
      </Link>
    }
  />
);

/** `passed/total` over the function steps that were meant to run: IFs and skipped steps don't count. */
export const passedSteps = (run: FlowRun): string => {
  const counted = run.steps.filter((s) => !isIf(s) && s.status !== 'skipped');
  return `${counted.filter((s) => s.status === 'passed').length}/${counted.length}`;
};

export const FlowsPage = () => {
  const navigate = useNavigate();
  const { data: presets } = usePresets();
  const { data: runs = [] } = useFlowRuns();
  return (
    <div className="wide-page">
      <h1>Flows</h1>
      <p className="lead">Functions joined one after another, with IF branches where a step depends on a value. Each step passes what it made on to the next.</p>
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
