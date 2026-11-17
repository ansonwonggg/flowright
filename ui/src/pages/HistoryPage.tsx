import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryTable } from '../components/HistoryTable.tsx';
import { historyRows, matchesRow, type HistoryFilter } from '../lib/historyRows.ts';
import { useFlowRuns, useHistory } from '../queries.ts';

export const HistoryPage = () => {
  const navigate = useNavigate();
  const { data: history = [] } = useHistory();
  const { data: flows = [] } = useFlowRuns();
  const [filter, setFilter] = useState<HistoryFilter>({ status: 'all', query: '' });
  const rows = historyRows(history, flows).filter((r) => matchesRow(r, filter));
  return (
    <div className="wide-page">
      <h1>History</h1>
      <p className="lead">Every run on this machine, from the app, a flow or the terminal. A flow is one row; ▸ shows its steps. Kept in out/runs/ and out/flow-runs/.</p>
      <div className="filters">
        <div className="seg">
          {(['all', 'passed', 'failed'] as const).map((s) => (
            <button key={s} type="button" className={filter.status === s ? 'on' : ''} onClick={() => setFilter({ ...filter, status: s })}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search history" placeholder="Search function, flow, parameters, ref…" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
      </div>
      <section className="tight">
        {rows.length ? (
          <HistoryTable
            rows={rows}
            onOpenRun={(id, flowId) => navigate(flowId ? `/run/${id}?flow=${encodeURIComponent(flowId)}` : `/run/${id}`)}
            onOpenFlow={(id) => navigate(`/flow-run/${id}`)}
          />
        ) : (
          <div className="empty">No runs match.</div>
        )}
      </section>
    </div>
  );
};
