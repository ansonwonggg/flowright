import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HistoryItem } from '../api.ts';
import { HistoryTable } from '../components/bits.tsx';
import { useHistory } from '../queries.ts';

/** Which runs a history filter keeps: `failed` means anything that ended other than passed. */
export type HistoryFilter = { status: 'all' | 'passed' | 'failed'; query: string };

/** Whether a run matches a history filter. The query matches function, parameters, inputs and records made. */
export const matchesHistory = (run: HistoryItem, filter: HistoryFilter): boolean => {
  if (filter.status === 'passed' && run.status !== 'passed') return false;
  if (filter.status === 'failed' && ['passed', 'running', 'stopping'].includes(run.status)) return false;
  const q = filter.query.trim().toLowerCase();
  const text = `${run.title} ${run.summary} ${Object.values(run.input ?? {}).join(' ')} ${(run.records ?? []).map((r) => `${r.ref} ${r.summary}`).join(' ')}`;
  return !q || text.toLowerCase().includes(q);
};

export const HistoryPage = () => {
  const navigate = useNavigate();
  const { data: history = [] } = useHistory();
  const [filter, setFilter] = useState<HistoryFilter>({ status: 'all', query: '' });
  const runs = history.filter((r) => matchesHistory(r, filter));
  return (
    <>
      <h1>History</h1>
      <p className="lead">Every run on this machine, from the app, a flow or the terminal. Kept in out/runs/.</p>
      <div className="filters">
        <div className="seg">
          {(['all', 'passed', 'failed'] as const).map((s) => (
            <button key={s} type="button" className={filter.status === s ? 'on' : ''} onClick={() => setFilter({ ...filter, status: s })}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search history" placeholder="Search function, parameters, ref…" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
      </div>
      <section className="tight">{runs.length ? <HistoryTable runs={runs} onOpen={(id) => navigate(`/run/${id}`)} /> : <div className="empty">No runs match.</div>}</section>
    </>
  );
};
