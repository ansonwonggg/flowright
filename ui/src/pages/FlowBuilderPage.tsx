import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, type Meta, type Preset } from '../api.ts';
import { useDialog } from '../components/Dialog.tsx';
import { RunBar } from '../components/RunBar.tsx';
import { fileNameOf, slugify } from '../lib/flowChart.ts';
import { flatten, flowSummary, isIf, stepTitle } from '../../../src/flow.ts';
import { foldMissing, stepErrors } from '../lib/flowChart.ts';
import { draftFrom, flatIndexes, flowOf, flowOfRun, groupOf, isDraftIf, newIf, newStep, removeKey, replaceStep, titleOf, type DraftItem } from '../lib/flowDraft.ts';
import { readPref, writePref } from '../lib/hooks.ts';
import { DragSteps } from './DragSteps.tsx';
import { AddFunction, IfCard } from './IfBlock.tsx';
import { StepCard } from './StepCard.tsx';
import { useFlowCheck, useFlowRun, useLive, useMeta, usePresets, useSaveFlow, useStartFlow } from '../queries.ts';

type BuilderMode = 'form' | 'drag';

const MODES: [BuilderMode, string][] = [
  ['form', 'Form'],
  ['drag', 'Flow chart'],
];

const FlowBuilder = ({ meta, initial, flows }: { meta: Meta; initial?: Preset; flows?: Preset[] }) => {
  const navigate = useNavigate();
  const [steps, setSteps] = useState<DraftItem[]>(() => (initial ? draftFrom(meta.functions, meta.fields, initial.spec, meta.options) : []));
  const [title, setTitle] = useState(() => titleOf(initial?.spec));
  const [group, setGroup] = useState(() => groupOf(initial?.spec));
  const [fileName, setFileName] = useState(() => fileNameOf(initial?.file));
  const [headed, setHeaded] = useState(() => readPref('headed') === '1');
  const [mode, setMode] = useState<BuilderMode>(() => (readPref('builderMode') === 'drag' ? 'drag' : 'form'));
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const { data: live } = useLive();
  const start = useStartFlow();
  const save = useSaveFlow();
  const { confirm, notify, dialog } = useDialog();

  const flow = flowOf(steps, meta.fields, title, group);
  const check = useFlowCheck(flow);
  const errors = check.data?.errors ?? [];
  const warnings = check.data?.warnings ?? [];
  const checking = check.isPending || check.isPlaceholderData;
  const fnOf = (id: string) => meta.functions.find((f) => f.id === id);
  const at = flatIndexes(steps);
  const flat = flatten(flow);
  const titles = flat.map((s) => `${!isIf(s) && s.branch ? `${s.branch.arm === 'then' ? 'true' : 'false'} → ` : ''}${stepTitle(meta.functions, s)}`);
  const problems = foldMissing(errors, flat.map((s) => stepTitle(meta.functions, s)));
  const named = title.trim() || fileName.trim();
  const runName = named || flowSummary(meta.functions, flow);
  const saveAs = fileName.trim() || slugify(title);
  const savedFile = flows?.find((f) => f.file === `config/flows/${saveAs}.flow.json`)?.file;
  const kinds = Object.values(meta.settings.records).map((r) => r.label);
  const offered = meta.functions;

  const run = async () => {
    const body = (
      <>
        <ol>
          {titles.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
        <p className="box warn">This makes permanent records on DEV.</p>
      </>
    );
    if (!(await confirm({ title: named ? `Start ${named}?` : 'Start this flow?', body, ok: 'Start' }))) return;
    try {
      const { id } = await start.mutateAsync({ name: runName, flow, headed, file: savedFile });
      navigate(`/flow-run/${id}`);
    } catch (e) {
      await notify('Could not start the flow', (e as Error).message);
    }
  };

  const saveFlow = async (overwrite = false): Promise<void> => {
    setSaved('');
    try {
      const { file } = await save.mutateAsync({ name: saveAs, flow, overwrite });
      setSaved(`Saved ${file}`);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) return notify('Could not save the flow', (e as Error).message);
      if (await confirm({ title: 'Replace the saved flow?', body: `${String(e.body.file)} already exists.`, ok: 'Replace', tone: 'danger' })) return saveFlow(true);
    }
  };

  return (
    <div className={`focus${mode === 'drag' ? ' wide' : ''}`}>
      {dialog}
      <Link className="crumb" to="/flows">
        ← Flows
      </Link>
      <div className="pagehead">
        <h1>{named || 'New flow'}</h1>
        <span className="spacer" />
        <div className="modes" role="radiogroup" aria-label="Builder mode">
          {MODES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className={`btn small${mode === value ? ' on' : ''}`}
              onClick={() => {
                setMode(value);
                writePref('builderMode', value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className={`btn small${saving ? ' on' : ''}`} aria-expanded={saving} onClick={() => setSaving(!saving)}>
          Save…
        </button>
      </div>
      <p className="lead">
        Functions run one after another{kinds.length > 0 && ` on one ${kinds.join(' or one ')}`}. A blank input takes the value an earlier step gave under that name, or the
        record's. An IF runs its true or false branch depending on a value an earlier step gave.
      </p>
      {saving && (
        <section className="card drawer-card" aria-label="Save the flow">
          <div className="two-fields">
            <div className="field">
              <label htmlFor="flow-title">Title</label>
              <input id="flow-title" type="text" value={title} placeholder="e.g. New ER user" onChange={(e) => setTitle(e.target.value)} />
              <div className="hint">The heading here, and the name on its runs.</div>
            </div>
            <div className="field">
              <label htmlFor="flow-file">File name</label>
              <input id="flow-file" type="text" value={fileName} placeholder={slugify(title) || 'e.g. new-er-user'} onChange={(e) => setFileName(e.target.value)} />
              <div className="hint">{saveAs ? `Saves to config/flows/${saveAs}.flow.json` : 'Where Save puts it, under config/flows/.'}</div>
            </div>
          </div>
          <div className="field">
            <label htmlFor="flow-group">Group</label>
            <input id="flow-group" type="text" value={group} placeholder="e.g. Member" onChange={(e) => setGroup(e.target.value)} />
            <div className="hint">The heading it is listed under on Home and Flows. Blank: under Other.</div>
          </div>
          <div className="inline">
            <button type="button" className="btn" disabled={!saveAs || !steps.length} onClick={() => saveFlow()}>
              Save as preset
            </button>
            {saved && <span className="ok-text">{saved}</span>}
          </div>
        </section>
      )}
      {mode === 'drag' ? (
        <DragSteps steps={steps} flow={flow} meta={meta} errors={errors} onSteps={setSteps} flows={flows} />
      ) : (
        <div className="stack">
          {steps.map((item) =>
            isDraftIf(item) ? (
              <IfCard
                key={item.key}
                item={item}
                index={at.get(item.key) ?? 0}
                at={at}
                flow={flow}
                meta={meta}
                errors={stepErrors(errors, at.get(item.key) ?? 0)}
                onChange={(next) => setSteps(steps.map((s) => (s.key === item.key ? next : s)))}
                onRemove={() => setSteps(removeKey(steps, item.key))}
              />
            ) : (
              <StepCard
                key={item.key}
                index={at.get(item.key) ?? 0}
                step={item}
                fn={fnOf(item.fn)}
                flow={flow}
                meta={meta}
                onChange={(next) => setSteps(replaceStep(steps, item.key, next))}
                onRemove={() => setSteps(removeKey(steps, item.key))}
              />
            ),
          )}
          {offered.length ? (
            <div className="add-row">
              <AddFunction id="add-step" label={steps.length ? 'Add a step' : 'First step'} fns={offered} onAdd={(id) => setSteps([...steps, newStep(meta.functions, meta.fields, id, meta.options)])} />
              <button type="button" className="btn" disabled={!steps.length} title={steps.length ? 'Branch on a value an earlier step gives' : 'An IF needs a step before it'} onClick={() => setSteps([...steps, newIf()])}>
                + Add an IF
              </button>
            </div>
          ) : (
            <div className="muted center">No function can follow the last one.</div>
          )}
        </div>
      )}
      <RunBar
        problems={problems}
        notes={[
          ...(live
            ? [
                <>
                  "{live.title}" is running. <Link to={`/run/${live.id}`}>Watch it</Link>. Runs go one at a time.
                </>,
              ]
            : []),
          ...warnings.map((w) => `${w}. That step will stop when it first needs one.`),
        ]}
        checking={checking}
        ready="The flow can run"
        headed={headed}
        onHeaded={(on) => {
          setHeaded(on);
          writePref('headed', on ? '1' : '0');
        }}
      >
        <button type="button" className="btn primary" disabled={Boolean(live) || checking || errors.length > 0} onClick={run}>
          Run the flow
        </button>
      </RunBar>
    </div>
  );
};

const FromFlowRun = ({ id, meta, flows }: { id: string; meta: Meta; flows: Preset[] }) => {
  const { data: run, error, isPending } = useFlowRun(id);
  if (error) return <div className="empty">{error.message}</div>;
  if (isPending) return <div className="empty">Loading…</div>;
  const spec = flowOfRun(run, meta.functions, meta.fields);
  return <FlowBuilder key={`run:${id}`} meta={meta} initial={{ file: run.file ?? '', label: run.name, summary: '', spec }} flows={flows} />;
};

export const FlowBuilderPage = () => {
  const { data: meta } = useMeta();
  const { data: presets } = usePresets();
  const [params] = useSearchParams();
  const wanted = params.get('preset');
  const runId = params.get('run');
  if (!meta || !presets) return <div className="empty">Loading…</div>;
  if (runId) return <FromFlowRun id={runId} meta={meta} flows={presets.flows} />;
  const preset = wanted ? presets.flows.find((p) => p.file === wanted) : undefined;
  if (wanted && !preset) return <div className="empty">No saved flow {wanted}.</div>;
  return <FlowBuilder key={wanted ?? 'new'} meta={meta} initial={preset} flows={presets.flows} />;
};
