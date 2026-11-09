import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toSpec, toValues, withSelectDefaults, type FormValues } from '../../../src/forms/engine.ts';
import { ApiError, type FieldJson, type Fn, type Meta, type Preset, type Presets, type RecordRow } from '../api.ts';
import { useDialog } from '../components/Dialog.tsx';
import { kindLabel } from '../components/bits.tsx';
import { FnTitle } from '../components/FnTitle.tsx';
import { FormRenderer } from '../components/FormRenderer.tsx';
import { Menu } from '../components/Menu.tsx';
import { RunBar } from '../components/RunBar.tsx';
import { ValueInput } from '../components/ValueInput.tsx';
import { splitTag } from '../lib/flowChart.ts';
import { formOf } from '../lib/flowDraft.ts';
import { ago, who } from '../lib/format.ts';
import { readPref, writePref } from '../lib/hooks.ts';
import { useInputCheck, useLive, useMeta, usePresets, useRecords, useRun, useSavePreset, useStartRun } from '../queries.ts';

/** Saved presets for a JSON input with a presets folder; none for other fields. */
export const presetsFor = (field: FieldJson | undefined, presets: Presets | undefined): Preset[] =>
  (field?.kind === 'json' && field.presets && presets?.fields[field.name]) || [];

/** Records a function can run on now: of its kind, with it among their next functions. */
export const eligible = (fn: Pick<Fn, 'id' | 'record'>, records: RecordRow[]) => records.filter((r) => r.kind === fn.record && r.next.some((n) => n.id === fn.id));

const MASK = '••••';

type Initial = { values: Record<string, string>; json: Record<string, unknown>; source?: string };

const JsonInput = ({ fn, field, meta, presets, start, values, onChange }: { fn: Fn; field: FieldJson; meta: Meta; presets: Preset[]; start: string; values: FormValues; onChange: (v: FormValues) => void }) => {
  const form = formOf(field)!;
  const [source, setSource] = useState(start);
  const [saveName, setSaveName] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const save = useSavePreset();
  const { confirm, notify, dialog } = useDialog();
  const load = (file: string) => {
    setSource(file);
    setSaved('');
    const spec = file === 'blank' ? form.blank : presets.find((p) => p.file === file)?.spec;
    onChange(withSelectDefaults(form, toValues(form, spec), meta.options, fn.id));
    if (file.startsWith('config/')) writePref(`preset:${fn.id}`, file);
  };
  const savePreset = async (overwrite = false): Promise<void> => {
    try {
      const { file } = await save.mutateAsync({ field: field.name, name: saveName, value: toSpec(form, values, fn.id), overwrite });
      setSource(file);
      setSaved(`Saved ${file}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.exists) {
        if (await confirm({ title: 'Replace the preset?', body: `${String(e.body.file)} already exists.`, ok: 'Replace', tone: 'danger' })) return savePreset(true);
        return;
      }
      await notify('Could not save the preset', (e as Error).message);
    }
  };
  return (
    <section className="card">
      {dialog}
      <div className="card-head">
        <h2 className="sub">{field.label}</h2>
        <span className="spacer" />
        <Menu label={`${field.label} options`} items={[{ label: 'Save as preset…', checked: saving, onSelect: () => setSaving(!saving) }]} />
      </div>
      <div className="preset-bar">
        <label htmlFor="source">Start from</label>
        <select id="source" value={source} onChange={(e) => load(e.target.value)}>
          {source === 'current' && (
            <option value="current" disabled>
              As given
            </option>
          )}
          <option value="blank">Blank</option>
          {presets.map((p) => (
            <option key={p.file} value={p.file}>
              {p.label} — {p.summary}
            </option>
          ))}
        </select>
      </div>
      {saving && (
        <div className="drawer">
          <div className="inline">
            <input type="text" aria-label="Preset name" value={saveName} placeholder="preset name, e.g. team-a/admin" onChange={(e) => setSaveName(e.target.value)} />
            <button type="button" className="btn" disabled={!saveName.trim()} onClick={() => savePreset()}>
              Save as preset
            </button>
          </div>
          <div className="hint">Saved to config/{field.presets}/&lt;name&gt;.json. Commit it to share with the team.</div>
          {saved && <div className="box ok gap-top">{saved}</div>}
        </div>
      )}
      <FormRenderer form={form} values={values} onChange={onChange} options={meta.options} project={fn.id} />
    </section>
  );
};

const RecordPicker = ({ fn, field, meta, records, value, onChange }: { fn: Fn; field: FieldJson; meta: Meta; records: RecordRow[]; value: string; onChange: (v: string) => void }) => {
  const list = eligible(fn, records);
  const noun = kindLabel(fn.record ?? '', meta);
  return (
    <section className="card">
      <h2 className="sub">Which {noun}?</h2>
      {list.length ? (
        <div className="choices">
          {list.map((r) => (
            <label key={r.key} className={`choice ${value === r.key ? 'on' : ''}`}>
              <input type="radio" name="record" checked={value === r.key} onChange={() => onChange(r.key)} />
              <span>
                <span className="mono strong">{r.key}</span> {who(r.summary, r.key)}
                <div className="hint">
                  {r.stageLabel} · {ago(r.updatedAt)}
                </div>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className="muted">No {noun} under out/records is ready for this.</div>
      )}
      <div className="field gap-top">
        <label htmlFor={`in-${field.name}`}>Or type a {field.label}</label>
        <input id={`in-${field.name}`} type="text" value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
        <div className="hint">Inputs you leave blank come from its record.</div>
      </div>
    </section>
  );
};

const FunctionForm = ({ fn, meta, presets, records, initial }: { fn: Fn; meta: Meta; presets?: Presets; records: RecordRow[]; initial: Initial }) => {
  const navigate = useNavigate();
  const fieldOf = (name: string) => meta.fields.find((f) => f.name === name);
  const jsonNames = Object.keys(fn.inputs).filter((name) => formOf(fieldOf(name)));
  const key = fn.recordKey && !fn.starts ? fn.recordKey : undefined;
  const plainNames = Object.keys(fn.inputs).filter((name) => name !== key && !jsonNames.includes(name));
  const [values, setValues] = useState(initial.values);
  const [forms, setForms] = useState<Record<string, FormValues>>(() =>
    Object.fromEntries(jsonNames.map((name) => [name, withSelectDefaults(formOf(fieldOf(name))!, toValues(formOf(fieldOf(name))!, initial.json[name]), meta.options, fn.id)])),
  );
  const [headed, setHeaded] = useState(() => readPref('headed') === '1');
  const { data: live } = useLive();
  const start = useStartRun();
  const { confirm, notify, dialog } = useDialog();

  const payload: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())),
    ...Object.fromEntries(jsonNames.map((name) => [name, toSpec(formOf(fieldOf(name))!, forms[name], fn.id)])),
  };
  const check = useInputCheck(fn.id, payload);
  const problems = check.data?.problems ?? [];
  const fromRecord = check.data?.fromRecord ?? [];
  const checking = check.isPending || check.isPlaceholderData;
  const set = (name: string, value: string) => setValues({ ...values, [name]: value });

  const run = async () => {
    const target = key && values[key] ? `${fn.title} on ${values[key]}` : fn.title;
    if (!(await confirm({ title: `Start ${target}?`, body: <p className="box warn">This makes permanent records on DEV.</p>, ok: 'Start' }))) return;
    try {
      const { id } = await start.mutateAsync({ function: fn.id, values: payload, headed });
      navigate(`/run/${id}`);
    } catch (e) {
      await notify('Could not start the run', (e as Error).message);
    }
  };

  return (
    <div className="stack">
      {dialog}
      <div className="stack">
        {key && <RecordPicker fn={fn} meta={meta} field={fieldOf(key)!} records={records} value={values[key] ?? ''} onChange={(v) => set(key, v)} />}
        {jsonNames.map((name) => (
          <JsonInput
            key={name}
            fn={fn}
            field={fieldOf(name)!}
            meta={meta}
            presets={presetsFor(fieldOf(name), presets)}
            start={initial.source ?? 'current'}
            values={forms[name]}
            onChange={(v) => setForms({ ...forms, [name]: v })}
          />
        ))}
        {plainNames.length > 0 && (
          <section className="card">
            <h2 className="sub">{key ? 'Other inputs' : 'Inputs'}</h2>
            <div className="block-fields">
              {plainNames.map((name) => {
                const field = fieldOf(name) ?? { name, kind: 'text' as const, label: name };
                const required = fn.inputs[name] === 'required';
                const placeholder = fromRecord.includes(name) ? 'from the record' : (field.placeholder ?? (required ? 'required' : ''));
                return (
                  <div className="field" key={name}>
                    <label htmlFor={`in-${name}`}>
                      {field.label}
                      {required && !fromRecord.includes(name) && <span className="bad-text"> *</span>}
                    </label>
                    <ValueInput id={`in-${name}`} field={field} meta={meta} value={values[name] ?? ''} placeholder={placeholder} onChange={(v) => set(name, v)} />
                    {field.hint && <div className="hint">{field.hint}</div>}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
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
          ...((check.data?.missingEnv ?? []).length > 0
            ? [
                <>
                  <b>.env.local is missing</b> {check.data!.missingEnv.join(', ')}. The run will stop when it first needs one.
                </>,
              ]
            : []),
          ...(check.data?.unknownRecord ? [`No saved record for ${values[key!]}; give every input yourself.`] : []),
        ]}
        checking={checking}
        ready="Ready to run"
        readyHint={fromRecord.length > 0 ? `${fromRecord.length} input(s) come from the record.` : undefined}
        headed={headed}
        onHeaded={(on) => {
          setHeaded(on);
          writePref('headed', on ? '1' : '0');
        }}
      >
        <button type="button" className="btn primary" disabled={Boolean(live) || checking || problems.length > 0} onClick={run}>
          Run {splitTag(fn.title).name}
        </button>
      </RunBar>
    </div>
  );
};

const FromRun = ({ id, children }: { id: string; children: (initial: Initial) => React.ReactNode }) => {
  const { data, error } = useRun(id);
  if (error) return <div className="empty">{error.message}</div>;
  if (!data) return <div className="empty">Loading…</div>;
  const values: Record<string, string> = {};
  const json: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data.run.input ?? {})) {
    if (v === MASK) continue;
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === 'object') json[k] = parsed;
      else values[k] = v;
    } catch {
      values[k] = v;
    }
  }
  return <>{children({ values, json })}</>;
};

export const FunctionPage = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { data: meta } = useMeta();
  const { data: presets } = usePresets();
  const { data: records = [] } = useRecords();
  if (!meta || !presets) return <div className="empty">Loading…</div>;
  const fn = meta.functions.find((f) => f.id === id);
  if (!fn) return <div className="empty">No function {id}.</div>;
  const ref = params.get('ref');
  const runId = params.get('run');
  const form = (initial: Initial) => <FunctionForm key={`${id}:${ref}:${runId}`} fn={fn} meta={meta} presets={presets} records={records} initial={initial} />;
  const jsonName = Object.keys(fn.inputs).find((name) => formOf(meta.fields.find((f) => f.name === name)));
  const remembered = jsonName ? presetsFor(meta.fields.find((f) => f.name === jsonName), presets).find((p) => p.file === readPref(`preset:${fn.id}`)) : undefined;
  const fresh: Initial = {
    values: ref && fn.recordKey ? { [fn.recordKey]: ref } : {},
    json: jsonName && remembered ? { [jsonName]: remembered.spec } : {},
    source: remembered ? remembered.file : 'blank',
  };
  return (
    <div className="focus">
      <Link className="crumb" to="/">
        ← All functions
      </Link>
      <h1>
        <FnTitle title={fn.title} />
      </h1>
      <p className="lead">{fn.detail}</p>
      {runId ? <FromRun id={runId}>{form}</FromRun> : form(fresh)}
    </div>
  );
};
