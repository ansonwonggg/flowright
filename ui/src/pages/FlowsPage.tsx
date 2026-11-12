import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isIf } from '../../../src/flow.ts';
import type { FlowRun, Preset } from '../api.ts';
import { StatusPill } from '../components/bits.tsx';
import { FlowTable } from '../components/FlowTable.tsx';
import { FnTitle } from '../components/FnTitle.tsx';
import { Grouped } from '../components/Grouped.tsx';
import { groupOf } from '../lib/flowDraft.ts';
import { filterRows, flowRows, nextSort, parseSort, sortRows, type FlowRow, type Sort, type SortKey } from '../lib/flowList.ts';
import { when } from '../lib/format.ts';
import { groupItems } from '../lib/groups.ts';
import { readPref, writePref } from '../lib/hooks.ts';
import { useFlowRuns, usePresets } from '../queries.ts';

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

type View = 'list' | 'cards';

const VIEWS: [View, string][] = [
  ['list', 'List'],
  ['cards', 'Cards'],
];

/** Flow runs shown before "Show all". */
export const RECENT_RUNS = 10;

const RecentRuns = ({ runs }: { runs: FlowRun[] }) => {
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  if (!runs.length) return <div className="muted">No flow has run yet.</div>;
  const shown = all ? runs : runs.slice(0, RECENT_RUNS);
  return (
    <>
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
            {shown.map((r) => (
              <tr key={r.id} className="click" onClick={() => navigate(`/flow-run/${r.id}`)}>
                <td className="strong">{r.name}</td>
                <td>
                  <StatusPill status={r.status} />
                </td>
                <td className="muted">{passedSteps(r)}</td>
                <td className="muted nowrap">{when(r.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {runs.length > RECENT_RUNS && (
        <button type="button" className="btn small more-runs" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${runs.length}`}
        </button>
      )}
    </>
  );
};

type FlowsBodyProps = { view: View; flows: Preset[]; rows: FlowRow[]; sort: Sort; query: string; onSort: (key: SortKey) => void; onClear: () => void };

const FlowsBody = ({ view, flows, rows, sort, query, onSort, onClear }: FlowsBodyProps) => {
  if (query.trim() && !rows.length)
    return (
      <div className="empty">
        No flow matches “{query.trim()}”.{' '}
        <button type="button" className="btn small" onClick={onClear}>
          Clear filter
        </button>
      </div>
    );
  if (view === 'cards') {
    const shown = new Set(rows.map((r) => r.file));
    return <FlowCards flows={flows.filter((f) => shown.has(f.file))} />;
  }
  if (!rows.length) return <div className="empty">No saved flows yet. Build one with + New flow.</div>;
  return (
    <section className="tight">
      <FlowTable rows={sortRows(rows, sort)} sort={sort} onSort={onSort} />
    </section>
  );
};

export const FlowsPage = () => {
  const { data: presets } = usePresets();
  const { data: runs = [] } = useFlowRuns();
  const [view, setView] = useState<View>(() => (readPref('flowsView') === 'cards' ? 'cards' : 'list'));
  const [sort, setSort] = useState<Sort>(() => parseSort(readPref('flowsSort')));
  const [query, setQuery] = useState('');

  const flows = presets?.flows ?? [];
  const rows = filterRows(flowRows(flows, runs), query);
  const filtering = query.trim() !== '';

  const changeView = (next: View) => {
    setView(next);
    writePref('flowsView', next);
  };
  const changeSort = (key: SortKey) => {
    const next = nextSort(sort, key);
    setSort(next);
    writePref('flowsSort', JSON.stringify(next));
  };

  return (
    <div className="wide-page">
      <h1>Flows</h1>
      <p className="lead">Functions joined one after another, with IF branches where a step depends on a value. Each step passes what it made on to the next.</p>
      <div className="filters">
        <input type="search" aria-label="Filter flows" placeholder="Filter by name, group, step…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted nowrap" aria-live="polite">
          {filtering ? `${rows.length} of ${flows.length} flows` : `${flows.length} flow${flows.length === 1 ? '' : 's'}`}
        </span>
        <div className="modes" role="radiogroup" aria-label="Show flows as">
          {VIEWS.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={view === value} className={`btn small${view === value ? ' on' : ''}`} onClick={() => changeView(value)}>
              {label}
            </button>
          ))}
        </div>
        {view === 'list' && (
          <Link className="btn primary small" to="/flow-builder">
            + New flow
          </Link>
        )}
      </div>
      <FlowsBody view={view} flows={flows} rows={rows} sort={sort} query={query} onSort={changeSort} onClear={() => setQuery('')} />
      <h2>Recent flow runs</h2>
      <RecentRuns runs={runs} />
    </div>
  );
};
