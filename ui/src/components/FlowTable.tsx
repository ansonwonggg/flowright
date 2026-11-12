import { Link, useNavigate } from 'react-router-dom';
import { when } from '../lib/format.ts';
import type { FlowRow, Sort, SortKey } from '../lib/flowList.ts';
import { StatusPill } from './bits.tsx';

/** Props of {@link FlowTable}. */
export type FlowTableProps = {
  /** Already filtered and sorted; shown in this order. */
  rows: FlowRow[];
  sort: Sort;
  /** Called with the column whose header was clicked; the caller works out the new sort (see `nextSort`). */
  onSort: (key: SortKey) => void;
};

const COLUMNS: [SortKey, string][] = [
  ['name', 'Name'],
  ['group', 'Group'],
  ['steps', 'Steps'],
  ['lastRun', 'Last run'],
  ['modified', 'Modified'],
];

const builderLink = (file: string) => `/flow-builder?preset=${encodeURIComponent(file)}`;

const ariaSort = (sort: Sort, key: SortKey) => {
  if (sort.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
};

const arrow = (sort: Sort, key: SortKey) => {
  if (sort.key !== key) return '↕';
  return sort.dir === 'asc' ? '▲' : '▼';
};

/**
 * Saved flows as a table with a sortable header per column. Clicking a row opens the flow in the builder;
 * the last run's cell opens that run instead.
 */
export const FlowTable = ({ rows, sort, onSort }: FlowTableProps) => {
  const navigate = useNavigate();
  return (
    <table className="flowtable">
      <thead>
        <tr>
          {COLUMNS.map(([key, label]) => (
            <th key={key} className={`col-${key}`} aria-sort={ariaSort(sort, key)}>
              <button type="button" className={`sorter${sort.key === key ? ' on' : ''}`} onClick={() => onSort(key)}>
                {label}
                <span className="sort-arrow" aria-hidden="true">
                  {arrow(sort, key)}
                </span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.file} className="click" onClick={() => navigate(builderLink(r.file))}>
            <td className="strong">
              <Link to={builderLink(r.file)} onClick={(e) => e.stopPropagation()}>
                {r.label}
              </Link>
            </td>
            <td className="muted">{r.group || '—'}</td>
            <td title={r.steps}>
              <div className="flow-steps">
                <span className="count">{r.stepCount}</span>
                <span className="chainline">{r.steps}</span>
              </div>
            </td>
            <td className="nowrap">
              {r.lastRun ? (
                <Link className="lastrun" to={`/flow-run/${r.lastRun.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Last run ${r.lastRun.status}, ${when(r.lastRun.startedAt)}`}>
                  <StatusPill status={r.lastRun.status} />
                  <span className="muted">{when(r.lastRun.startedAt)}</span>
                </Link>
              ) : (
                <span className="muted">Never</span>
              )}
            </td>
            <td className="muted nowrap">{r.modifiedAt === undefined ? '—' : when(r.modifiedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
