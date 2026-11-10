import { CopyButton } from './bits.tsx';

const laidOut = (value: string): string => {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : value;
  } catch {
    return value;
  }
};

/**
 * Named values as copyable tiles: a run's inputs, a flow step's input or output, the values a flow passed along.
 * A JSON object or array is laid out over several lines, full width; Copy copies the value as given. Nothing to
 * show gives a dash.
 *
 * @param label - the list's accessible name, e.g. "Step 2 output".
 * @param nameOf - the shown name for a value's key, e.g. its field label; the key itself when left out.
 */
export const Values = ({ values, label, nameOf = (k) => k }: { values?: Record<string, string>; label: string; nameOf?: (key: string) => string }) => {
  const rows = Object.entries(values ?? {});
  if (!rows.length) return <div className="muted">—</div>;
  return (
    <div className="vals" aria-label={label}>
      {rows.map(([k, v]) => {
        const shown = laidOut(String(v ?? ''));
        const multiLine = shown.includes('\n');
        return (
          <div key={k} className={`val${multiLine ? ' wide' : ''}`}>
            <span className="k">{nameOf(k)}</span>
            {multiLine ? <pre className="v">{shown}</pre> : <span className="v">{shown}</span>}
            <CopyButton text={String(v ?? '')} />
          </div>
        );
      })}
    </div>
  );
};
