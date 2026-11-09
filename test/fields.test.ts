import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defineFields, field, fieldFromJson, fieldJson, readValue, valueProblem } from '../src/fields.ts';

const ref = field.text({ label: 'Ref', pattern: /^DMD\d+$/, placeholder: 'DMD…', hint: 'h' });
const kind = field.select({ label: 'Kind', options: ['A', 'B'] });
const secret = field.secret({ label: 'Password', pattern: /^.{4,}$/ });

describe('defineFields', () => {
  it('returns the registry as given', () => assert.deepEqual(defineFields({ ref_no: ref }), { ref_no: ref }));
  for (const bad of ['Ref', 'ref-no', '1ref', ''])
    it(`refuses the name "${bad}"`, () => assert.throws(() => defineFields({ [bad]: ref }), /must be snake_case/));
  it('refuses a select with no options', () => assert.throws(() => defineFields({ k: field.select({ label: 'K', options: [] }) }), /no options/));
});

describe('valueProblem', () => {
  it('fine values', () => {
    assert.equal(valueProblem('ref', ref, 'DMD1'), undefined);
    assert.equal(valueProblem('kind', kind, 'B'), undefined);
    assert.equal(valueProblem('free', field.text({ label: 'Free' }), 'anything'), undefined);
  });
  it('a pattern miss names the field and the value', () => assert.equal(valueProblem('ref', ref, 'X1'), 'ref "X1" doesn\'t match /^DMD\\d+$/'));
  it('a secret miss hides the value', () => assert.match(valueProblem('password', secret, 'ab')!, /"••••"/));
  it('a select miss lists the options', () => assert.equal(valueProblem('kind', kind, 'C'), 'kind "C" must be one of A, B'));
  it('a name not in the registry', () => assert.equal(valueProblem('nope', undefined, 'x'), '"nope" is not in the field registry'));
});

describe('fieldJson / fieldFromJson', () => {
  it('text keeps pattern source, placeholder and hint', () =>
    assert.deepEqual(fieldJson('ref', ref), { name: 'ref', kind: 'text', label: 'Ref', hint: 'h', pattern: '^DMD\\d+$', placeholder: 'DMD…' }));
  it('select keeps options', () => assert.deepEqual(fieldJson('kind', kind), { name: 'kind', kind: 'select', label: 'Kind', options: ['A', 'B'] }));
  it('a bare text field has only name, kind and label', () => assert.deepEqual(fieldJson('t', field.text({ label: 'T' })), { name: 't', kind: 'text', label: 'T' }));
  for (const [name, f] of Object.entries({ ref, kind, secret }))
    it(`${name} round-trips with the same checks`, () => {
      const back = fieldFromJson(fieldJson(name, f));
      for (const v of ['DMD1', 'A', 'abcd', 'x']) assert.equal(valueProblem(name, back, v), valueProblem(name, f, v));
    });
  it('a select without options in JSON gets none', () => assert.deepEqual(fieldFromJson({ name: 'k', kind: 'select', label: 'K' }), { kind: 'select', label: 'K', options: [] }));
});

describe('json fields', () => {
  const spec = field.json<{ company: string }>({
    label: 'Spec',
    form: { fields: ['company'] },
    validate: (v) => (v && typeof v === 'object' && 'company' in v ? [] : ['company is required', 'and more']),
  });
  it('readValue parses and validates', () => assert.deepEqual(readValue('spec', spec, '{"company":"P"}'), { value: { company: 'P' } }));
  it('not JSON', () => assert.equal(valueProblem('spec', spec, '{bad'), 'spec is not JSON'));
  it('validator problems, joined', () => assert.equal(valueProblem('spec', spec, '{}'), 'spec: company is required; and more'));
  it('without a validator any JSON is fine', () => assert.deepEqual(readValue('x', field.json({ label: 'X' }), '[1]'), { value: [1] }));
  it('text fields read as the text itself', () => assert.deepEqual(readValue('ref', ref, 'DMD1'), { value: 'DMD1' }));
  it('JSON keeps the form, drops the validator; back again', () => {
    const json = fieldJson('spec', spec);
    assert.deepEqual(json, { name: 'spec', kind: 'json', label: 'Spec', form: { fields: ['company'] } });
    assert.deepEqual(fieldFromJson(json), { kind: 'json', label: 'Spec', form: { fields: ['company'] } });
    assert.deepEqual(fieldFromJson({ name: 'x', kind: 'json', label: 'X', hint: 'h' }), { kind: 'json', label: 'X', hint: 'h' });
  });
  it('JSON keeps the presets folder and drops describe and env', () => {
    const f = field.json<{ creator: string }>({ label: 'S', presets: 'users', describe: (v) => v?.creator ?? '?', env: (v) => [`${v?.creator}_USER`] });
    assert.deepEqual(fieldJson('s', f), { name: 's', kind: 'json', label: 'S', presets: 'users' });
    assert.deepEqual(fieldFromJson(fieldJson('s', f)), { kind: 'json', label: 'S', presets: 'users' });
    assert.equal(f.describe?.({ creator: 'ER' }), 'ER');
    assert.deepEqual(f.env?.(undefined), ['undefined_USER']);
  });
  it('a select keeps its labels, both ways', () => {
    const f = field.select({ label: 'T', options: ['SEP'], labels: { SEP: 'Self-employed' } });
    assert.deepEqual(fieldJson('t', f), { name: 't', kind: 'select', label: 'T', options: ['SEP'], labels: { SEP: 'Self-employed' } });
    assert.deepEqual(fieldFromJson(fieldJson('t', f)), f);
  });
});
