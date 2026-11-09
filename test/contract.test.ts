import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkOutput, masked, prepareInput, type Contract } from '../src/contract.ts';
import { field } from '../src/fields.ts';

const fn: Contract = {
  id: 'activate',
  fields: { ref: field.text({ label: 'Ref', pattern: /^DMD\d+$/ }), mobile: field.text({ label: 'Mobile', pattern: /^\d{8}$/ }), password: field.secret({ label: 'Password' }), status: field.text({ label: 'Status' }), spec: field.json({ label: 'Spec', validate: (v) => (Array.isArray(v) ? ['no lists'] : []) }) },
  inputs: { ref: 'required', mobile: 'optional', password: 'optional', spec: 'optional' },
  outputs: ['ref', 'status', 'password', 'spec'],
};

describe('prepareInput', () => {
  it('keeps declared names only, trimmed', () => assert.deepEqual(prepareInput(fn, { ref: ' DMD1 ', mobile: '91234567', other: 'x' }), { ref: 'DMD1', mobile: '91234567' }));
  it('an optional input may be missing or blank', () => assert.deepEqual(prepareInput(fn, { ref: 'DMD1', mobile: '  ' }), { ref: 'DMD1' }));
  it('lists every problem at once', () =>
    assert.throws(() => prepareInput(fn, { mobile: '123' }), (e: Error) => e.message === 'activate can\'t start:\n- missing ref (Ref)\n- mobile "123" doesn\'t match /^\\d{8}$/'));
  it('a blank required input counts as missing', () => assert.throws(() => prepareInput(fn, { ref: ' ' }), /missing ref/));
  it('an input not in the registry is named', () => assert.throws(() => prepareInput({ ...fn, inputs: { ghost: 'optional' } }, { ghost: 'x' }), /"ghost" is not in the field registry/));
  it('a JSON input arrives parsed, and is validated', () => {
    assert.deepEqual(prepareInput(fn, { ref: 'DMD1', spec: '{"a":1}' }), { ref: 'DMD1', spec: { a: 1 } });
    assert.throws(() => prepareInput(fn, { ref: 'DMD1', spec: '[1]' }), /spec: no lists/);
  });
  it('a missing required input without a registry entry uses its name', () => assert.throws(() => prepareInput({ ...fn, inputs: { ghost: 'required' } }, {}), /missing ghost \(ghost\)/));
});

describe('checkOutput', () => {
  it('keeps declared non-empty strings; drops undefined and empty', () =>
    assert.deepEqual(checkOutput(fn, { ref: 'DMD1', status: '', password: undefined }), { ref: 'DMD1' }));
  it('an undeclared output is a bug', () => assert.throws(() => checkOutput(fn, { ref: 'DMD1', mobile: '91234567' }), /returned "mobile", which isn't in its outputs/));
  it('a non-string value', () => assert.throws(() => checkOutput(fn, { status: 3 }), /status must be a string, got number/));
  it('a JSON output may be an object; it is checked and written as JSON text', () => {
    assert.deepEqual(checkOutput(fn, { spec: { a: 1 } }), { spec: '{"a":1}' });
    assert.throws(() => checkOutput(fn, { spec: [1] }), /spec: no lists/);
  });
  it('a value breaking its rule', () => assert.throws(() => checkOutput(fn, { ref: 'X' }), /ref "X" doesn't match/));
  for (const bad of [undefined, null, 'x', ['a']]) it(`not an object: ${JSON.stringify(bad)}`, () => assert.throws(() => checkOutput(fn, bad), /must return an object/));
});

it('masked hides secrets only', () => assert.deepEqual(masked(fn.fields, { ref: 'DMD1', password: 'p', other: 'o' }), { ref: 'DMD1', password: '••••', other: 'o' }));
