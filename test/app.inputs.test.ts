import { describe, it as test } from 'node:test';
import { cleanFlow, filledInputs, inputProblems, presetPath, summarize } from '../src/app/inputs.ts';
import { field } from '../src/fields.ts';
import type { FunctionMeta } from '../src/fn.ts';
import type { RecordFile } from '../src/records.ts';
import { expect } from './expect.ts';

const fn = (inputs: FunctionMeta['inputs']) => ({ inputs });
const FIELDS = {
  reference_no: field.text({ label: 'DataMod ref', pattern: /^DMD\d+$/ }),
  mobile: field.text({ label: 'Mobile', pattern: /^\d{8}$/ }),
  spec: field.json({ label: 'Spec', validate: (v) => (v && typeof v === 'object' && 'company' in v ? [] : ['company is required']) }),
};
const record = (values: Record<string, string>) => ({ values }) as unknown as RecordFile;

describe('presetPath', () => {
  test('a name, with or without .json, or one sub-folder', () => {
    expect(presetPath('users', ' other-user ')).toEqual({ file: 'config/users/other-user.json' });
    expect(presetPath('users', 'a.json')).toEqual({ file: 'config/users/a.json' });
    expect(presetPath('users', 'cr089/g5')).toEqual({ file: 'config/users/cr089/g5.json' });
  });
  test('a flow keeps its own suffix, given or not', () => {
    expect(presetPath('flows', 'mine', '.flow.json')).toEqual({ file: 'config/flows/mine.flow.json' });
    expect(presetPath('flows', 'mine.flow.json', '.flow.json')).toEqual({ file: 'config/flows/mine.flow.json' });
  });
  for (const bad of ['', '  ', 'A', '../x', 'a/b/c', 'a b', 5, undefined])
    test(`refuses ${JSON.stringify(bad)}`, () => expect(presetPath('users', bad)).toHaveProperty('error'));
});

describe('filledInputs', () => {
  test('only declared names, as text; an inline object becomes JSON', () =>
    expect(filledInputs(fn({ reference_no: 'required', spec: 'optional' }), { reference_no: ' DMD1 ', spec: { company: 'P' }, other: 'x' })).toEqual({
      reference_no: 'DMD1',
      spec: '{"company":"P"}',
    }));
  test('gaps come from the record; given values win', () =>
    expect(filledInputs(fn({ reference_no: 'required', mobile: 'required' }), { reference_no: 'DMD1' }, record({ mobile: '91234567', reference_no: 'X' }))).toEqual({
      reference_no: 'DMD1',
      mobile: '91234567',
    }));
  test('blank values are not given', () => expect(filledInputs(fn({ mobile: 'optional' }), { mobile: ' ' })).toEqual({}));
});

describe('inputProblems', () => {
  test('fine', () => expect(inputProblems(fn({ reference_no: 'required', mobile: 'optional' }), FIELDS, { reference_no: 'DMD1' })).toEqual([]));
  test('a missing required input by its label, or its name when unknown', () =>
    expect(inputProblems(fn({ reference_no: 'required', ghost: 'required' }), FIELDS, {})).toEqual(['DataMod ref is required', 'ghost is required']));
  test('values breaking their rules, JSON through its validator', () =>
    expect(inputProblems(fn({ mobile: 'optional', spec: 'optional' }), FIELDS, { mobile: '12', spec: '{}' })).toEqual([
      'mobile "12" doesn\'t match /^\\d{8}$/',
      'spec: company is required',
    ]));
});

describe('summarize', () => {
  const fields = {
    user_spec: field.json<{ company: string }>({ label: 'User', describe: (v) => `for ${v?.company ?? '?'}` }),
    accounts: field.json<Record<string, string>>({ label: 'Accounts', describe: (v) => Object.keys(v ?? {}).join(', ') }),
    plain: field.json({ label: 'No describe' }),
    reference_no: field.text({ label: 'Ref' }),
    account_type: field.select({ label: 'Type', options: ['PA'] }),
    password: field.secret({ label: 'Password' }),
  };
  test('JSON inputs in words, in registry order, then every text and select value; never a secret', () =>
    expect(summarize({ reference_no: 'DMD1', accounts: '{"G1":"DMD1","G2":"DMD2"}', user_spec: '{"company":"PCCW"}', account_type: 'PA', password: 'pw', plain: '{}' }, fields)).toBe(
      'for PCCW · G1, G2 · DMD1 · PA',
    ));
  test('only the names asked for, in that order', () => expect(summarize({ reference_no: 'DMD1', account_type: 'PA', password: 'pw' }, fields, ['account_type', 'password'])).toBe('PA · pw'));
  test('JSON that does not parse reaches describe as undefined', () => expect(summarize({ user_spec: '{bad' }, fields)).toBe('for ?'));
  test('names the registry lacks are not shown by default', () => expect(summarize({ other: 'x' }, fields)).toBe(''));
  for (const old of [undefined, null, 'config/users/a.json', ['x']]) test(`old or odd input ${JSON.stringify(old)} gives ''`, () => expect(summarize(old, fields)).toBe(''));
});

describe('cleanFlow', () => {
  test('keeps title, function and values as text', () =>
    expect(cleanFlow({ title: ' T ', steps: [{ function: 'a', values: { x: ' 1 ', y: '', s: { company: 'P' } }, extra: 1 }] })).toEqual({
      title: 'T',
      steps: [{ function: 'a', values: { x: '1', s: '{"company":"P"}' } }],
    }));
  test('a step without values has none', () => expect(cleanFlow({ steps: [{ function: 'a', values: {} }] })).toEqual({ steps: [{ function: 'a' }] }));
  for (const body of [undefined, null, 'x', {}, { steps: 'x' }]) test(`no steps: ${JSON.stringify(body)}`, () => expect(cleanFlow(body)).toEqual({ steps: [] }));
  test('junk steps become blank ones, for flowProblems to name', () =>
    expect(cleanFlow({ title: '  ', steps: [null, { function: 5, values: [1] }] })).toEqual({ steps: [{ function: '' }, { function: '' }] }));
});
