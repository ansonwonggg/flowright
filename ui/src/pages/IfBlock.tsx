import type { Arm } from '../../../src/flow.ts';
import type { FlowDef, Fn, Meta } from '../api.ts';
import { newStep, testableBefore, type DraftCondition, type DraftIf, type DraftOp, type DraftStep } from '../lib/flowDraft.ts';
import { StepCard } from './StepCard.tsx';

const OPS: [DraftOp, string][] = [
  ['equals', 'is'],
  ['notEquals', 'is not'],
  ['set', 'is set'],
];

/** An IF's condition as three boxes: the value to test (what earlier steps give), how, and the text. */
export const ConditionEditor = ({ id, cond, names, onChange }: { id: string; cond: DraftCondition; names: string[]; onChange: (cond: DraftCondition) => void }) => {
  const offered = cond.value && !names.includes(cond.value) ? [cond.value, ...names] : names;
  return (
    <div className="cond-row">
      <div className="field">
        <label htmlFor={`${id}-value`}>Value</label>
        <select id={`${id}-value`} value={cond.value} onChange={(e) => onChange({ ...cond, value: e.target.value })}>
          <option value="">{names.length ? 'Choose a value…' : 'No earlier step gives a value'}</option>
          {offered.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-op`}>Test</label>
        <select id={`${id}-op`} value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as DraftOp })}>
          {OPS.map(([op, label]) => (
            <option key={op} value={op}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {cond.op !== 'set' && (
        <div className="field">
          <label htmlFor={`${id}-to`}>Text</label>
          <input id={`${id}-to`} type="text" value={cond.to} placeholder="blank: is empty" onChange={(e) => onChange({ ...cond, to: e.target.value })} />
        </div>
      )}
    </div>
  );
};

/** A select that adds a function when one is chosen, then resets. */
export const AddFunction = ({ id, label, fns, onAdd }: { id: string; label: string; fns: Fn[]; onAdd: (fnId: string) => void }) => (
  <div className="field add-step">
    <label htmlFor={id}>{label}</label>
    <select id={id} value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
      <option value="">Choose a function…</option>
      {fns.map((f) => (
        <option key={f.id} value={f.id}>
          {f.title}
        </option>
      ))}
    </select>
  </div>
);

/** Words for an arm's heading: `true` / `false` and when it runs. */
export const armHeading = (arm: Arm) => (arm === 'then' ? 'True: runs when the test holds' : 'False: runs otherwise');

type IfCardProps = {
  item: DraftIf;
  index: number;
  at: Map<string, number>;
  flow: FlowDef;
  meta: Meta;
  errors: string[];
  onChange: (item: DraftIf) => void;
  onRemove: () => void;
};

/** The form-mode IF: its condition, then each arm's steps as step cards with a picker to add one. */
export const IfCard = ({ item, index, at, flow, meta, errors, onChange, onRemove }: IfCardProps) => {
  const n = index + 1;
  const fns = meta.functions;
  const setArm = (arm: Arm, steps: DraftStep[]) => onChange({ ...item, [arm]: steps });
  return (
    <section className="card if-card" aria-label={`Step ${n}`}>
      <div className="card-head">
        <h3>
          <span className="step-no if">{n}</span> If
        </h3>
        <span className="spacer" />
        <button type="button" className="btn small ghost" aria-label={`Remove step ${n}`} onClick={onRemove}>
          Remove
        </button>
      </div>
      <ConditionEditor id={`if${n}`} cond={item.cond} names={testableBefore(fns, flow, index)} onChange={(cond) => onChange({ ...item, cond })} />
      {errors.length > 0 && (
        <ul className="node-errors flush">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="if-arms">
        {(['then', 'else'] as const).map((arm) => (
          <div key={arm} className={`if-arm ${arm}`} aria-label={`Step ${n} ${arm === 'then' ? 'true' : 'false'} branch`}>
            <h3 className="sub">{armHeading(arm)}</h3>
            {item[arm].map((step) => (
              <StepCard
                key={step.key}
                index={at.get(step.key) ?? 0}
                step={step}
                fn={fns.find((f) => f.id === step.fn)}
                flow={flow}
                meta={meta}
                onChange={(next) => setArm(arm, item[arm].map((s) => (s.key === step.key ? next : s)))}
                onRemove={() => setArm(arm, item[arm].filter((s) => s.key !== step.key))}
              />
            ))}
            <AddFunction id={`if${n}-${arm}-add`} label={item[arm].length ? 'Add a step' : 'First step'} fns={fns} onAdd={(id) => setArm(arm, [...item[arm], newStep(fns, meta.fields, id, meta.options)])} />
          </div>
        ))}
      </div>
    </section>
  );
};
