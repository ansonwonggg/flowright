import type { FlowDef, Fn, Meta } from '../api.ts';
import { FnTitle } from '../components/FnTitle.tsx';
import { FormRenderer } from '../components/FormRenderer.tsx';
import { ValueInput } from '../components/ValueInput.tsx';
import { formOf, inputSource, placeholderFor, type DraftStep } from '../lib/flowDraft.ts';

export type StepCardProps = {
  index: number;
  step: DraftStep;
  fn?: Fn;
  flow: FlowDef;
  meta: Meta;
  onChange: (step: DraftStep) => void;
  onRemove: () => void;
  bare?: boolean;
};

/**
 * One step of the builder: its function, each JSON input as its form, and a box per other input. `bare`
 * leaves out the heading and Remove, for when the step's own node already shows them.
 */
export const StepCard = ({ index, step, fn, flow, meta, onChange, onRemove, bare = false }: StepCardProps) => {
  const n = index + 1;
  const fieldOf = (name: string) => meta.fields.find((f) => f.name === name) ?? { name, kind: 'text' as const, label: name };
  const names = Object.keys(fn?.inputs ?? {});
  const json = names.filter((name) => formOf(fieldOf(name)));
  const plain = names.filter((name) => !json.includes(name));
  return (
    <section className={`card chain-step${bare ? ' bare' : ''}`} aria-label={`Step ${n}`}>
      {!bare && (
        <div className="card-head">
          <h3>
            <span className="step-no">{n}</span> {fn ? <FnTitle title={fn.title} /> : `Unknown function "${step.fn}"`}
          </h3>
          <button type="button" className="btn small ghost" aria-label={`Remove step ${n}`} onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
      {fn && <div className="muted small gap">{fn.detail}</div>}
      {json.map((name) => (
        <div key={name} className="gap-top">
          <FormRenderer form={formOf(fieldOf(name))!} values={step.forms[name] ?? {}} onChange={(v) => onChange({ ...step, forms: { ...step.forms, [name]: v } })} options={meta.options} project={step.fn} />
        </div>
      ))}
      {plain.length > 0 && (
        <div className="block-fields">
          {plain.map((name) => {
            const field = fieldOf(name);
            const required = fn?.inputs[name] === 'required';
            const placeholder = placeholderFor(meta.functions, flow, index, field, required);
            const id = `step${n}-${name}`;
            return (
              <div className="field" key={name}>
                <label htmlFor={id}>
                  {field.label}
                  {required && !Object.keys(inputSource(meta.functions, flow, index, name, required)).length && <span className="bad-text"> *</span>}
                </label>
                <ValueInput id={id} field={field} meta={meta} value={step.values[name] ?? ''} placeholder={placeholder} onChange={(v) => onChange({ ...step, values: { ...step.values, [name]: v } })} />
              </div>
            );
          })}
        </div>
      )}
      {fn && !bare && <div className="gives">Gives: {fn.outputs.join(', ') || 'nothing'}</div>}
    </section>
  );
};
