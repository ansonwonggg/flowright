import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { findFiles, loadRepo, manifestOf } from '../src/discover.ts';
import type { FunctionMeta } from '../src/fn.ts';
import type { Values } from '../src/io.ts';
import { runFlow } from '../src/runner.ts';

const SRC = pathToFileURL(path.resolve(import.meta.dirname, '../src/index.ts')).href;

const KIT = `import { createKit, defineFields, field } from '${SRC}';
export const fields = defineFields({ ref: field.text({ label: 'Ref', pattern: /^DMD\\d+$/ }), status: field.text({ label: 'Status' }), password: field.secret({ label: 'Password' }) });
export const { defineFunction, defineStep } = createKit(fields, { test: {}, records: { user: 'ref' } });`;

const fnFile = (id: string, extra = '') => `import { defineFunction } from '../kit.ts';
export default defineFunction({ id: '${id}', title: '${id}', record: 'user', inputs: { ref: 'required' }, outputs: ['ref', 'status'], run: async (_, i) => ({ ref: i.ref }) ${extra} });`;

const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'flowkit-'));
  for (const [file, body] of Object.entries({ 'kit.ts': KIT, ...files })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  return root;
};

const messages = async (root: string) => (await loadRepo(root)).problems.map((p) => `${p.layer} ${p.file}: ${p.message}`);

describe('findFiles', () => {
  it('finds by suffix, sorted, skipping dot folders, node_modules and test output', () => {
    const root = repo({ 'b/x.fn.ts': '', 'a/y.fn.ts': '', '.hidden/z.fn.ts': '', 'node_modules/n.fn.ts': '', 'test-results/t.fn.ts': '', 'a/y.step.ts': '' });
    assert.deepEqual(findFiles(root, '.fn.ts').map((f) => path.relative(root, f)), ['a/y.fn.ts', 'b/x.fn.ts']);
  });
  it('a missing root gives nothing', () => assert.deepEqual(findFiles('/no/such/dir', '.fn.ts'), []));
});

describe('loadRepo: the pattern checks', () => {
  it('a clean repo has no problems', async () => {
    const root = repo({
      'u/vet.fn.ts': fnFile('vet'),
      'u/steps/a.step.ts': `import { defineStep } from '../../kit.ts'; export const a = defineStep({ name: 'A', portal: 'web', run: async () => {} });`,
      'flows/v.flow.json': JSON.stringify({ steps: [{ function: 'vet', values: { ref: 'DMD1' } }] }),
    });
    const loaded = await loadRepo(root);
    assert.deepEqual(loaded.problems, []);
    assert.deepEqual(loaded.functions.map((f) => f.def.id), ['vet']);
    assert.deepEqual(loaded.steps, [{ file: 'u/steps/a.step.ts', names: ['a'] }]);
    assert.deepEqual(Object.keys(loaded.fields), ['ref', 'status', 'password']);
  });

  it('function files: no defineFunction, id not the file name, duplicate ids, load errors', async () => {
    const root = repo({
      'u/plain.fn.ts': 'export default { id: "plain" };',
      'u/wrong.fn.ts': fnFile('right'),
      'v/twin.fn.ts': fnFile('twin'),
      'w/twin.fn.ts': fnFile('twin'),
      'u/broken.fn.ts': 'throw new Error("cannot load\\nsecond line");',
    });
    assert.deepEqual(await messages(root), [
      'function u/broken.fn.ts: can\'t be loaded: cannot load',
      'function u/plain.fn.ts: the default export must come from defineFunction',
      'function u/wrong.fn.ts: id "right" must match the file name "wrong"',
      'function w/twin.fn.ts: id "twin" is also used by v/twin.fn.ts',
    ]);
  });

  it('record rules: the kind must be declared; a starting function outputs the key, others take it', async () => {
    const root = repo({
      'u/ghost.fn.ts': fnFile('ghost').replace("record: 'user'", "record: 'ghost'"),
      'u/maker.fn.ts': `import { defineFunction } from '../kit.ts';\nexport default defineFunction({ id: 'maker', title: 'm', record: 'user', starts: true, inputs: {}, outputs: ['status'], run: async () => ({}) });`,
      'u/taker.fn.ts': `import { defineFunction } from '../kit.ts';\nexport default defineFunction({ id: 'taker', title: 't', record: 'user', inputs: { status: 'required' }, outputs: [], run: async () => ({}) });`,
    });
    assert.deepEqual(await messages(root), [
      'function u/ghost.fn.ts: record "ghost" isn\'t declared in the kit\'s records',
      'function u/maker.fn.ts: makes a new user record, so it must output its key "ref"',
      'function u/taker.fn.ts: works on a user record, so it must take its key "ref" as an input',
    ]);
  });

  it('a function from another kit', async () => {
    const root = repo({ 'u/a.fn.ts': fnFile('a'), 'u/b.fn.ts': fnFile('b').replace("'../kit.ts'", "'../kit2.ts'"), 'kit2.ts': KIT });
    assert.deepEqual(await messages(root), ['function u/b.fn.ts: uses a different field registry from the other functions; make one kit and share it']);
  });

  it('step files: exports that are not steps, nothing exported, load errors', async () => {
    const root = repo({
      'u/steps/mixed.step.ts': `import { defineStep } from '../../kit.ts'; export const ok = defineStep({ name: 'A', portal: 'web', run: async () => {} }); export const helper = () => 1;`,
      'u/steps/empty.step.ts': 'export {};',
      'u/steps/broken.step.ts': 'throw new Error("nope");',
    });
    assert.deepEqual(await messages(root), [
      'step u/steps/broken.step.ts: can\'t be loaded: nope',
      'step u/steps/empty.step.ts: exports nothing; a step file exports its steps',
      'step u/steps/mixed.step.ts: export "helper" is not a step; make it with defineStep, or move it out of the step file',
    ]);
  });

  it('flow files: not JSON, flow problems, then secrets', async () => {
    const root = repo({
      'u/vet.fn.ts': fnFile('vet'),
      'f/bad.flow.json': '{bad',
      'f/unknown.flow.json': JSON.stringify({ steps: [{ function: 'nope' }] }),
      'f/secret.flow.json': JSON.stringify({ steps: [{ function: 'vet', values: { ref: 'DMD1' } }] }).replace('"ref"', '"password":"p","ref"'),
    });
    const found = await messages(root);
    assert.equal(found[0].startsWith('flow f/bad.flow.json: is not JSON'), true);
    assert.deepEqual(found.slice(1), ['flow f/secret.flow.json: Step 1: vet has no input "password"', 'flow f/unknown.flow.json: Step 1: unknown function "nope"']);
  });

  it('an empty repo has no fields and no problems', async () => {
    const loaded = await loadRepo(mkdtempSync(path.join(tmpdir(), 'flowkit-')));
    assert.deepEqual([loaded.fields, loaded.problems, loaded.functions], [{}, [], []]);
  });
});

describe('function order', () => {
  it('lowest order first; functions without one last, by file name', async () => {
    const root = repo({
      'a/c.fn.ts': fnFile('c', ', order: 2'),
      'a/b.fn.ts': fnFile('b'),
      'a/a.fn.ts': fnFile('a'),
      'a/z.fn.ts': fnFile('z', ', order: 1'),
    });
    assert.deepEqual((await loadRepo(root)).functions.map((f) => f.def.id), ['z', 'c', 'a', 'b']);
  });
});

describe('manifestOf', () => {
  it('functions with their file, fields as JSON, flows with titles', async () => {
    const root = repo({ 'u/vet.fn.ts': fnFile('vet', ", setup: ['login'], timeout: 9"), 'f/v.flow.json': JSON.stringify({ title: 'V', steps: [{ function: 'vet', values: { ref: 'DMD1' } }] }) });
    const m = manifestOf(await loadRepo(root));
    assert.deepEqual(m.functions[0], { id: 'vet', title: 'vet', detail: '', record: 'user', recordKey: 'ref', starts: false, inputs: { ref: 'required' }, outputs: ['ref', 'status'], env: [], setup: ['login'], timeout: 9, file: 'u/vet.fn.ts' });
    assert.deepEqual(m.fields[0], { name: 'ref', kind: 'text', label: 'Ref', pattern: '^DMD\\d+$' });
    assert.deepEqual(m.flows.map((f) => f.title), ['V']);
    assert.deepEqual(m.problems, []);
  });
  it("the kit's settings, and its app hooks on the repo only", async () => {
    const repoOf = await loadRepo(repo({ 'u/vet.fn.ts': fnFile('vet') }));
    assert.deepEqual(manifestOf(repoOf).settings.records, { user: { key: 'ref', label: 'user', summary: [] } });
    assert.deepEqual(repoOf.app, {});
  });
  it('no functions: the default settings', async () => {
    const m = manifestOf(await loadRepo(repo({})));
    assert.deepEqual(m.settings, { title: 'flowright', records: {}, command: 'npx flowright run .', unsetEnv: [], failures: [] });
  });
});

describe('runFlow with a fake exec', () => {
  const metas: FunctionMeta[] = [
    { id: 'a', title: 'A', detail: '', starts: true, inputs: {}, outputs: ['ref'], env: [], setup: [] },
    { id: 'b', title: 'B', detail: '', starts: false, inputs: { ref: 'required' }, outputs: ['status'], env: [], setup: [] },
    { id: 'c', title: 'C', detail: '', starts: false, inputs: { ref: 'required', status: 'optional' }, outputs: [], env: [], setup: [] },
  ];
  const flow = { title: 'T', steps: [{ function: 'a' }, { function: 'b' }, { function: 'c' }] };

  it('passes outputs on, saves each change, and passes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'flowkit-'));
    const calls: unknown[] = [];
    const seen: string[] = [];
    const run = await runFlow(root, metas, flow, {
      now: () => 0,
      onChange: (r) => seen.push(r.status),
      exec: async (fn, input, step) => {
        calls.push([fn.id, input, step]);
        const outputs: Record<string, Values> = { a: { ref: 'DMD1' }, b: { status: 'OK' } };
        return { status: 'passed', output: outputs[fn.id] ?? {} };
      },
    });
    assert.deepEqual(calls, [['a', {}, 1], ['b', { ref: 'DMD1' }, 2], ['c', { ref: 'DMD1', status: 'OK' }, 3]]);
    assert.equal(run.status, 'passed');
    assert.equal(run.name, 'T');
    assert.equal(seen.length, 7);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'out/flow-runs', `${run.id}.json`), 'utf8')).status, 'passed');
  });

  it('stops at the first failure; later steps never run', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'flowkit-'));
    const ran: string[] = [];
    const run = await runFlow(root, metas, flow, {
      exec: async (fn) => {
        ran.push(fn.id);
        return fn.id === 'b' ? { status: 'failed', error: 'boom' } : { status: 'passed', output: { ref: 'DMD1' } };
      },
    });
    assert.deepEqual(ran, ['a', 'b']);
    assert.deepEqual(run.steps.map((s) => s.status), ['passed', 'failed', 'waiting']);
    assert.equal(run.steps[1].error, 'boom');
  });

  it('an IF runs only the arm it takes; step numbers are flat', async () => {
    const branchy = { steps: [{ function: 'a' }, { function: 'b' }, { if: { value: 'status', equals: 'DDE' }, then: [{ function: 'c' }], else: [{ function: 'a' }] }] };
    for (const [status, ran, statuses] of [
      ['DDE', [['a', 1], ['b', 2], ['c', 4]], ['passed', 'passed', 'passed', 'passed', 'skipped']],
      ['OPEN', [['a', 1], ['b', 2], ['a', 5]], ['passed', 'passed', 'passed', 'skipped', 'passed']],
    ] as const) {
      const root = mkdtempSync(path.join(tmpdir(), 'flowkit-'));
      const calls: unknown[] = [];
      const run = await runFlow(root, metas, branchy, {
        exec: async (fn, _input, step) => {
          calls.push([fn.id, step]);
          const output: Values = fn.id === 'b' ? { status } : { ref: 'DMD1' };
          return { status: 'passed', output };
        },
      });
      assert.deepEqual(calls, ran);
      assert.deepEqual(run.steps.map((s) => s.status), statuses);
      assert.equal(run.status, 'passed');
    }
  });

  it('a flow without a title is named "flow"; a name option wins', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'flowkit-'));
    const exec = async () => ({ status: 'passed' as const });
    assert.equal((await runFlow(root, metas.slice(0, 1), { steps: [{ function: 'a' }] }, { exec })).name, 'flow');
    assert.equal((await runFlow(root, metas.slice(0, 1), { steps: [{ function: 'a' }] }, { exec, name: 'N' })).name, 'N');
  });
});
