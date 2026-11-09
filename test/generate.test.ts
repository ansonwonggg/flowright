import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadRepo } from '../src/discover.ts';
import { field } from '../src/fields.ts';
import type { FunctionMeta } from '../src/fn.ts';
import { flowSource, functionSource, importPath, newFlow, newFunction, newStep, parseInputs, parseList, stepSource, suggest, unknownNames } from '../src/generate.ts';
import { metaOf } from '../src/fn.ts';

const SRC = pathToFileURL(path.resolve(import.meta.dirname, '../src/index.ts')).href;
const KIT = `import { createKit, defineFields, field } from '${SRC}';
export const fields = defineFields({ reference_no: field.text({ label: 'Ref' }), mobile: field.text({ label: 'Mobile' }), status: field.text({ label: 'Status' }), spec: field.json({ label: 'Spec' }) });
export const { defineFunction, defineStep, records } = createKit(fields, { test: {}, records: { 'er-user': 'reference_no' } });`;
const repo = (kit: string | null = KIT) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gen-'));
  if (kit !== null) writeFileSync(path.join(root, 'kit.ts'), kit);
  return root;
};

describe('small helpers', () => {
  it('parseList', () => assert.deepEqual(parseList(' a, ,b '), ['a', 'b']));
  it('parseList of nothing', () => assert.deepEqual(parseList(undefined), []));
  it('parseInputs: required, optional, and optional wins when in both', () =>
    assert.deepEqual(parseInputs('a,b', 'b,c'), { a: 'required', b: 'optional', c: 'optional' }));
  it('suggest: close typos only', () => {
    assert.equal(suggest('mobil', ['mobile', 'status']), 'mobile');
    assert.equal(suggest('refernce_no', ['reference_no']), 'reference_no');
    assert.equal(suggest('zzz', ['mobile', 'status']), undefined);
    assert.equal(suggest('x', []), undefined);
  });
  it('unknownNames, with and without a suggestion', () =>
    assert.deepEqual(unknownNames(['mobile', 'mobil', 'zzz'], { mobile: field.text({ label: 'M' }) }), [
      '"mobil" is not in the field registry; did you mean "mobile"?',
      '"zzz" is not in the field registry',
    ]));
  it('importPath', () => {
    assert.equal(importPath('/r/a/b/x.fn.ts', '/r/kit.ts'), '../../kit.ts');
    assert.equal(importPath('/r/x.fn.ts', '/r/kit.ts'), './kit.ts');
  });
});

describe('sources', () => {
  it('step: named after the file, fails until built, quotes escaped', () => {
    const src = stepSource({ name: 'verify-identity', portal: "it's", kit: '../../kit.ts' });
    assert.match(src, /import \{ defineStep \} from '..\/..\/kit.ts';/);
    assert.match(src, /export const verifyIdentity = defineStep<\{ page: Page \}>/);
    assert.match(src, /name: 'Verify identity'/);
    assert.match(src, /portal: 'it\\'s'/);
    assert.match(src, /throw new Error\('verify-identity: not built yet'\)/);
  });
  it('function: record and starts only when given', () => {
    const plain = functionSource({ id: 'x', title: 'X', kit: '../kit.ts', inputs: { a: 'required' }, outputs: ['b'] });
    assert.doesNotMatch(plain, /record:|starts:/);
    assert.match(plain, /inputs: \{ a: 'required' \},\n {2}outputs: \['b'\],/);
    const full = functionSource({ id: 'x', title: 'X', kit: '../kit.ts', record: 'er-user', starts: true, inputs: {}, outputs: [] });
    assert.match(full, /record: 'er-user',\n {2}starts: true,/);
  });
  it('flow: blanks for what nothing earlier gives, {} for JSON', () => {
    const fns: FunctionMeta[] = [
      { id: 'make', title: 'M', detail: '', record: 'u', recordKey: 'reference_no', starts: true, inputs: { spec: 'required' }, outputs: ['reference_no', 'mobile'], env: [], setup: [] },
      { id: 'use', title: 'U', detail: '', record: 'u', recordKey: 'reference_no', starts: false, inputs: { reference_no: 'required', mobile: 'required', status: 'required' }, outputs: [], env: [], setup: [] },
    ];
    const fields = { spec: field.json({ label: 'S' }) };
    assert.deepEqual(flowSource({ title: 'T', functions: ['make', 'use'], fns, fields }), {
      title: 'T',
      steps: [{ function: 'make', values: { spec: {} } }, { function: 'use', values: { status: '' } }],
    });
    assert.deepEqual(flowSource({ title: 'T', functions: ['use'], fns, fields }).steps, [{ function: 'use', values: { reference_no: '', mobile: '', status: '' } }]);
  });
});

describe('newStep / newFunction / newFlow on a real repo', () => {
  it('generated files load and pass the pattern checks', async () => {
    const root = repo();
    newStep(root, 'er-user/check-status', 'admin');
    const made = await newFunction(root, 'er-user/check-er-user', { title: 'Check', record: 'er-user', optional: 'mobile', outputs: 'status' });
    assert.match(readFileSync(made.file, 'utf8'), /inputs: \{ reference_no: 'required', mobile: 'optional' \}/);
    await newFunction(root, 'er-user/make-er-user', { title: 'Make', record: 'er-user', starts: true, inputs: 'spec', outputs: 'status' });
    assert.match(readFileSync(path.join(root, 'er-user/make-er-user.fn.ts'), 'utf8'), /outputs: \['reference_no', 'status'\]/);
    const loaded = await loadRepo(root);
    assert.deepEqual(loaded.problems, []);
    const flow = newFlow(root, 'make-and-check', ['make-er-user', 'check-er-user'], { fns: loaded.functions.map((f) => metaOf(f.def)), fields: loaded.fields });
    assert.deepEqual(JSON.parse(readFileSync(flow.file, 'utf8')).steps, [{ function: 'make-er-user', values: { spec: {} } }, { function: 'check-er-user' }]);
    assert.deepEqual(flow.next, ['fill in: Step 1: Make needs Spec']);
  });

  it('newStep refuses bad names and existing files', () => {
    const root = repo();
    assert.throws(() => newStep(repo(null), 'er-user/x'), /kit.ts not found/);
    assert.throws(() => newStep(root, 'ErUser/x'), /must look like <area>\/<name>/);
    assert.throws(() => newStep(root, 'er-user/Check'), /must look like/);
    newStep(root, 'er-user/x');
    assert.throws(() => newStep(root, 'er-user/x'), /already exists/);
  });

  it('newFunction lists every problem at once', async () => {
    await assert.rejects(newFunction(repo(), 'Bad/X', { record: 'ghost', starts: true, inputs: 'mobil', outputs: 'zzz' }), (e: Error) => {
      assert.match(e.message, /must look like <area>\/<id>/);
      assert.match(e.message, /--title is required/);
      assert.match(e.message, /record "ghost" isn't in the kit; known: er-user/);
      assert.match(e.message, /did you mean "mobile"/);
      assert.match(e.message, /"zzz" is not in the field registry/);
      return true;
    });
    await assert.rejects(newFunction(repo(), 'a/b', { title: 'T', starts: true }), /--starts needs --record/);
  });

  it('newFunction needs a kit that exports fields', async () => {
    await assert.rejects(newFunction(repo(null), 'a/b', { title: 'T' }), /kit.ts not found/);
    await assert.rejects(newFunction(repo('export const nothing = 1;'), 'a/b', { title: 'T' }), /must export "fields"/);
    const noRecords = repo(KIT.replace('export const { defineFunction, defineStep, records }', 'export const { defineFunction }'));
    await assert.rejects(newFunction(noRecords, 'a/b', { title: 'T', record: 'er-user' }), /known: none/);
  });

  it('newFlow refuses bad names, no functions, unknown ones with suggestions, and existing files', () => {
    const root = repo();
    const known = { fns: [{ id: 'vet-er-user', title: 'V', detail: '', starts: false, inputs: {}, outputs: [], env: [], setup: [] }], fields: {} };
    assert.throws(() => newFlow(root, 'Bad Name', ['vet-er-user'], known), /must be kebab-case/);
    assert.throws(() => newFlow(root, 'x', [], known), /at least one function/);
    assert.throws(() => newFlow(root, 'x', ['vet-er-usr'], known), /did you mean "vet-er-user"/);
    mkdirSync(path.join(root, 'config/flows'), { recursive: true });
    writeFileSync(path.join(root, 'config/flows/x.flow.json'), '{}');
    assert.throws(() => newFlow(root, 'x', ['vet-er-user'], known), /already exists/);
  });
});
