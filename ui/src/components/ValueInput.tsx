import type { FieldJson, Meta } from '../api.ts';
import { SuggestInput } from './SuggestInput.tsx';

/**
 * One input for a registry field: a select for a `select` field, a password box for a `secret`, else a
 * text box, offering as suggestions the `/api/meta` options list named after the field, when there is one.
 *
 * - `id`: the element id; label it with `<label htmlFor={id}>`.
 * - `placeholder`: what shows while empty, e.g. where the value will come from.
 * - `onChange`: gets the new text on every edit; `''` means not given.
 */
export const ValueInput = ({ id, field, value, placeholder, meta, onChange }: { id: string; field: FieldJson; value: string; placeholder: string; meta: Meta; onChange: (value: string) => void }) => {
  if (field.kind === 'select')
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder || '—'}</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {field.labels?.[o] ?? o}
          </option>
        ))}
      </select>
    );
  return (
    <SuggestInput
      id={id}
      type={field.kind === 'secret' ? 'password' : 'text'}
      value={value}
      placeholder={placeholder}
      suggestions={(meta.options[field.name] ?? []).map((o) => o.value)}
      onChange={onChange}
    />
  );
};
