import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defineFields, field } from '../src/fields.ts';
import { createKit, fromRoot, isFunction, metaOf, PLAYWRIGHT_ENV, ROOT_ENV } from '../src/fn.ts';
import { isStep, stepMaker, stepMeta, StepError } from '../src/step.ts';

const fields = defineFields({ ref: field.text({ label: 'Ref' }), status: field.text({ label: 'Status' }) });
const fakeTest = {} as never;
const { defineFunction, defineStep, records } = createKit(fields, { test: fakeTest, records: { user: 'ref' } });
const base = { title: 'Vet', inputs: { ref: 'required' }, outputs: ['status'], run: async () => ({ status: 'OK' }) } as const;

describe('defineFunction', () => {
  it('fills defaults and carries the registry', () => {
    const fn = defineFunction({ id: 'vet', ...base });
    assert.equal(isFunction(fn), true);
    assert.equal(fn.fields, fields);
    assert.deepEqual(metaOf(fn), { id: 'vet', title: 'Vet', detail: '', starts: false, inputs: { ref: 'required' }, outputs: ['status'], env: [], setup: [] });
  });
  it('the kit exposes its record kinds', () => assert.deepEqual(records, { user: 'ref' }));
  it('a function on a record knows its key and the records folder', () => {
    const fn = defineFunction({ id: 'vet', ...base, record: 'user' });
    assert.equal(fn.recordKey, 'ref');
    assert.equal(fn.recordsDir, 'out/records');
    assert.equal(createKit(fields, { test: fakeTest, recordsDir: 'data/r' }).defineFunction({ id: 'x', ...base }).recordsDir, 'data/r');
  });
  it('keeps every option in the meta', () => {
    const fn = defineFunction({ id: 'vet', ...base, detail: 'd', group: 'Web', order: 3, record: 'user', starts: true, env: ['E'], setup: ['login'], timeout: 5, use: { viewport: { width: 1, height: 2 } } });
    assert.deepEqual(metaOf(fn), {
      id: 'vet', title: 'Vet', detail: 'd', group: 'Web', order: 3, record: 'user', recordKey: 'ref', starts: true, inputs: { ref: 'required' }, outputs: ['status'], env: ['E'], setup: ['login'], timeout: 5, use: { viewport: { width: 1, height: 2 } },
    });
  });
  it('a group is trimmed; a blank one is left out of the meta', () => {
    assert.equal(metaOf(defineFunction({ id: 'vet', ...base, group: ' Admin DDE ' })).group, 'Admin DDE');
    for (const group of ['', '   ']) assert.equal('group' in metaOf(defineFunction({ id: 'vet', ...base, group })), false);
  });
  for (const id of ['Vet', 'vet_user', '1vet', ''])
    it(`refuses the id "${id}"`, () => assert.throws(() => defineFunction({ id, ...base }), /must be kebab-case/));
  it('registers no test outside the flowkit Playwright config', () => {
    assert.notEqual(process.env[PLAYWRIGHT_ENV], '1');
    assert.doesNotThrow(() => defineFunction({ id: 'vet', ...base }));
  });
  it('isFunction is false for anything else', () => {
    for (const v of [undefined, null, {}, () => {}, 'x']) assert.equal(isFunction(v), false);
  });
});

describe('kit settings', () => {
  it('defaults: record kinds labelled by name with no summary, the npx command, nothing unset, no rules', () => {
    const kit = createKit(fields, { test: fakeTest, records: { user: 'ref' } });
    assert.deepEqual(kit.settings, { title: 'flowkit', records: { user: { key: 'ref', label: 'user', summary: [] } }, command: 'npx flowkit run .', unsetEnv: [], failures: [] });
    assert.deepEqual(kit.defineFunction({ id: 'x', ...base }).app, {});
  });
  it('a record kind given in full, and every setting', () => {
    const app = { summary: ['ref'] };
    const kit = createKit(fields, {
      test: fakeTest,
      title: 'Flows',
      records: { user: { key: 'ref', label: 'User', summary: ['{status}'] }, other: { key: 'status' } },
      command: 'npm run fn --',
      unsetEnv: ['HTTPS_PROXY'],
      failures: [{ kind: 'k', match: 'm', title: 't', hint: 'h' }],
      app,
    });
    assert.deepEqual(kit.settings, {
      title: 'Flows',
      records: { user: { key: 'ref', label: 'User', summary: ['{status}'] }, other: { key: 'status', label: 'other', summary: [] } },
      command: 'npm run fn --',
      unsetEnv: ['HTTPS_PROXY'],
      failures: [{ kind: 'k', match: 'm', title: 't', hint: 'h' }],
    });
    const fn = kit.defineFunction({ id: 'x', ...base, record: 'user' });
    assert.equal(fn.recordKey, 'ref');
    assert.equal(fn.settings, kit.settings);
    assert.equal(fn.app, app);
  });
  it('settings and app hooks stay out of the meta', () => {
    const meta = metaOf(createKit(fields, { test: fakeTest, title: 'T', app: { summary: [] } }).defineFunction({ id: 'x', ...base }));
    assert.equal('settings' in meta || 'app' in meta, false);
  });
});

describe('defineStep', () => {
  const step = defineStep({ name: 'Fill', portal: 'web', run: async () => 1 });
  it('the kit gives one bound to its test; stepMaker makes the same', () => assert.equal(isStep(stepMaker(fakeTest)({ name: 'x', portal: 'y', run: async () => {} })), true));
  it('is a step with its name and portal', () => {
    assert.equal(isStep(step), true);
    assert.deepEqual(stepMeta(step), { name: 'Fill', portal: 'web' });
  });
  it('isStep is false for plain functions and values', () => {
    for (const v of [async () => 1, {}, null, 'x']) assert.equal(isStep(v), false);
  });
  it('StepError names portal and step, keeps the cause', () => {
    const cause = new Error('boom');
    const e = new StepError('web', 'Fill', cause);
    assert.equal(e.message, '[web] Fill: boom');
    assert.equal(e.cause, cause);
    assert.equal(new StepError('web', 'Fill', 'text').message, '[web] Fill: text');
  });
});

describe('fromRoot', () => {
  it('resolves from FLOWKIT_ROOT when set, else the working directory', () => {
    const before = process.env[ROOT_ENV];
    process.env[ROOT_ENV] = '/repo';
    assert.equal(fromRoot('out/records'), '/repo/out/records');
    delete process.env[ROOT_ENV];
    assert.equal(fromRoot('out/records'), `${process.cwd()}/out/records`);
    if (before !== undefined) process.env[ROOT_ENV] = before;
  });
});
