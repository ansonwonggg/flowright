import type { ReactNode } from 'react';
import { getAt, isShown, joinPath, setAt, shownRows, type EntryRow, type FormValues, type OptionLists } from '../../../src/forms/engine.ts';
import type { FormConfig, FormField, ItemField, Option } from '../../../src/forms/types.ts';
import { SuggestInput } from './SuggestInput.tsx';

/**
 * Draws any {@link FormConfig} as an editable form. Holds no state: `values` come in, `onChange` gets
 * the whole new value object on every edit.
 *
 * - `options`: live lists by source name (`/api/meta` `options`). A select whose current value isn't
 *   in its list still shows that value, so a preset naming an unknown creator stays visible.
 * - `project`: the running flow, for `showWhen: { $project: [...] }`.
 * - Fields hidden by `showWhen` are not rendered; their values stay in `values` but `toSpec` drops them.
 * - List and entries rows get accessible names like `Right 2 path` and `Remove right 2`. A list with
 *   `minRows` shows filler rows; editing one makes it real.
 */
export type FormRendererProps = {
  form: FormConfig;
  values: FormValues;
  onChange: (values: FormValues) => void;
  options: OptionLists;
  project: string;
};

const optionList = (source: string | Option[], options: OptionLists, current?: unknown): Option[] => {
  const list = typeof source === 'string' ? (options[source] ?? []) : source;
  const value = typeof current === 'string' ? current : '';
  return value && !list.some((o) => o.value === value) ? [...list, { value, label: value }] : list;
};

const fieldId = (key: string) => `f-${key.replace(/[^a-zA-Z0-9]/g, '-') || 'root'}`;

const Hint = ({ text }: { text?: string }) => (text ? <div className="hint">{text}</div> : null);

export const FormRenderer = ({ form, values, onChange, options, project }: FormRendererProps) => {
  const set = (key: string, value: unknown) => onChange(key ? setAt(values, key, value) : { ...values, [key]: value });
  const rowsAt = (key: string): unknown[] => {
    const rows = key ? getAt(values, key) : values[''];
    return Array.isArray(rows) ? rows : [];
  };

  const itemInput = (field: ItemField, row: Record<string, unknown>, name: string, update: (value: unknown) => void, emptyLabel?: string): ReactNode => {
    const raw = row[field.key];
    if (field.type === 'select')
      return (
        <select aria-label={name} value={typeof raw === 'string' ? raw : ''} onChange={(e) => update(e.target.value)}>
          {emptyLabel && <option value="">{emptyLabel}</option>}
          {optionList(field.options, options, raw).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    const placeholder = field.type === 'path' && field.placeholderBy ? field.placeholderBy.values[String(row[field.placeholderBy.key])] : field.placeholder;
    const text = field.type === 'path' && typeof raw !== 'string' ? joinPath(raw) : String(raw ?? '');
    return <input type="text" aria-label={name} value={text} placeholder={placeholder} onChange={(e) => update(e.target.value)} />;
  };

  const renderField = (field: FormField): ReactNode => {
    if (!isShown(field.showWhen, values, project)) return null;
    const id = fieldId(field.key);
    const value = getAt(values, field.key);

    switch (field.type) {
      case 'note':
        return <div className={`box ${field.tone}`}>{field.label}</div>;
      case 'text':
        return (
          <div className="field">
            <label htmlFor={id}>{field.label}</label>
            <SuggestInput
              id={id}
              value={typeof value === 'string' ? value : ''}
              placeholder={field.placeholder}
              suggestions={field.suggest ? (options[field.suggest] ?? []).map((o) => o.value) : []}
              onChange={(v) => set(field.key, v)}
            />
            <Hint text={field.hint} />
          </div>
        );
      case 'select':
        return (
          <div className="field">
            <label htmlFor={id}>{field.label}</label>
            <select id={id} value={typeof value === 'string' ? value : ''} onChange={(e) => set(field.key, e.target.value)}>
              {optionList(field.options, options, value).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Hint text={field.hint} />
          </div>
        );
      case 'radio':
        return (
          <fieldset className="field">
            <legend className="label">{field.label}</legend>
            <div className="radios">
              {optionList(field.options, options, value).map((o) => (
                <label key={o.value} className={o.value === value ? 'on' : ''}>
                  <input type="radio" name={id} value={o.value} checked={o.value === value} onChange={() => set(field.key, o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
            <Hint text={field.hint} />
          </fieldset>
        );
      case 'checkbox':
        return (
          <div className="field">
            <label className="check">
              <input type="checkbox" checked={value === true} onChange={(e) => set(field.key, e.target.checked)} /> {field.label}
            </label>
          </div>
        );
      case 'list': {
        const rows = shownRows(rowsAt(field.key), field.newItem, field.minRows);
        const update = (i: number, key: string, v: unknown) => set(field.key, rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
        return (
          <div className="field">
            <span className="label">{field.label}</span>
            <div className="rows">
              {rows.map((row, i) => (
                <div className="rowedit" key={i}>
                  {field.item.map((item) => (
                    <span key={item.key}>{itemInput(item, row ?? {}, `${field.itemLabel} ${i + 1} ${item.label}`, (v) => update(i, item.key, v))}</span>
                  ))}
                  <button type="button" className="btn icon" aria-label={`Remove ${field.itemLabel.toLowerCase()} ${i + 1}`} onClick={() => set(field.key, rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn small" onClick={() => set(field.key, [...rows, structuredClone(field.newItem)])}>
              {field.addLabel}
            </button>
            <Hint text={field.hint} />
          </div>
        );
      }
      case 'entries': {
        const rows = rowsAt(field.key) as EntryRow[];
        const update = (i: number, key: 'key' | 'value', v: unknown) => set(field.key, rows.map((r, j) => (j === i ? { ...r, [key]: String(v) } : r)));
        return (
          <div className="field">
            <span className="label">{field.label}</span>
            <div className="rows">
              {rows.map((row, i) => (
                <div className="rowedit acc" key={i}>
                  {itemInput(field.keyField, { [field.keyField.key]: row.key }, `${field.itemLabel} ${i + 1} ${field.keyField.label}`, (v) => update(i, 'key', v))}
                  {itemInput(field.valueField, { [field.valueField.key]: row.value }, `${field.itemLabel} ${i + 1} ${field.valueField.label}`, (v) => update(i, 'value', v), 'Pick…')}
                  <button type="button" className="btn icon" aria-label={`Remove ${field.itemLabel.toLowerCase()} ${i + 1}`} onClick={() => set(field.key, rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn small" onClick={() => set(field.key, [...rows, { key: '', value: '' }])}>
              {field.addLabel}
            </button>
            <Hint text={field.hint} />
          </div>
        );
      }
    }
  };

  return (
    <>
      {form.fields.map((field) => (
        <div key={`${field.type}:${field.key}`}>{renderField(field)}</div>
      ))}
    </>
  );
};
