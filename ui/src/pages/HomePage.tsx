import { Link, useNavigate } from 'react-router-dom';
import type { Fn, Meta, Presets } from '../api.ts';
import { HistoryTable } from '../components/bits.tsx';
import { useHistory, useLive, useMeta, usePresets } from '../queries.ts';
import { presetsFor } from './FunctionPage.tsx';
import { FlowCards } from './FlowsPage.tsx';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const usesFunction = (spec: unknown, id: string) => {
  const steps = (spec as { steps?: unknown } | undefined)?.steps;
  return Array.isArray(steps) && steps.some((step) => (step as { function?: unknown } | null)?.function === id);
};

/**
 * What a function card says: for a function with a JSON input, how many presets it can start from;
 * otherwise how many saved flows use it. Presets not loaded yet count as none.
 */
export const cardNote = (fn: Fn, meta: Meta, presets: Presets | undefined): string => {
  const json = Object.keys(fn.inputs).map((name) => meta.fields.find((f) => f.name === name)).find((f) => f?.kind === 'json');
  if (json) return plural(presetsFor(json, presets).length, 'saved preset');
  const flows = (presets?.flows ?? []).filter((flow) => usesFunction(flow.spec, fn.id)).length;
  return flows ? `Used in ${plural(flows, 'flow')}` : 'Not in any flow';
};

const FunctionCard = ({ fn, meta, presets }: { fn: Fn; meta: Meta; presets?: Presets }) => (
  <Link className="flowcard" to={`/fn/${fn.id}`}>
    <div className="t">{fn.title}</div>
    <div className="d">{fn.detail}</div>
    <div className="n muted">{cardNote(fn, meta, presets)}</div>
  </Link>
);

export const HomePage = () => {
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const { data: presets } = usePresets();
  const { data: history = [] } = useHistory();
  const { data: live } = useLive();
  if (!meta) return <div className="empty">Loading…</div>;
  return (
    <>
      {live && (
        <div className="banner">
          <span className="spin">◐</span>
          <span>
            <b>{live.title}</b> is running · {live.summary}
          </span>
          <span className="spacer" />
          <Link to={`/run/${live.id}`}>Watch it →</Link>
        </div>
      )}
      <h1>What do you want to make?</h1>
      <p className="lead">Every run makes permanent records on DEV. Runs go one at a time.</p>
      <h2>Flows</h2>
      <FlowCards flows={presets?.flows ?? []} />
      <h2>Run one function</h2>
      <div className="cards">
        {meta.functions.map((fn) => (
          <FunctionCard key={fn.id} fn={fn} meta={meta} presets={presets} />
        ))}
      </div>
      <h2>
        Recent runs <Link className="h2-link" to="/history">all →</Link>
      </h2>
      {history.length ? (
        <section className="tight">
          <HistoryTable runs={history.slice(0, 5)} onOpen={(id) => navigate(`/run/${id}`)} />
        </section>
      ) : (
        <div className="muted">Nothing yet. Runs appear here, including ones started from the terminal.</div>
      )}
    </>
  );
};
