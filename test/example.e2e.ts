import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { FlowRun } from '../src/flow.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXAMPLE = path.join(ROOT, 'example');
const RUNS = path.join(EXAMPLE, 'out/flow-runs');
const env = { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' };

const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...args], { cwd: ROOT, env, encoding: 'utf8' });

const lastRun = (): FlowRun => {
  const files = readdirSync(RUNS).filter((f) => f.endsWith('.json')).sort();
  return JSON.parse(readFileSync(path.join(RUNS, files.at(-1)!), 'utf8'));
};

const runFlow = (file: string) => {
  const result = cli('run', 'example', file);
  return { code: result.status, out: result.stdout + result.stderr, run: lastRun() };
};

describe('the example repo, in a real browser', { timeout: 300_000 }, () => {
  it('follows the pattern', () => {
    const result = cli('check', 'example');
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /✓ 5 functions, 5 step files, 3 flows follow the pattern/);
  });

  it('web flow: setup runs first, the ref and person pass on, the password is masked', () => {
    const { code, out, run } = runFlow('example/config/flows/new-er-user.flow.json');
    assert.equal(code, 0, out);
    assert.deepEqual(run.steps.map((s) => s.status), ['passed', 'passed', 'passed']);
    assert.match(out, /Running admin-login, vet-er-user/);
    const ref = run.steps[0].output!.reference_no;
    assert.match(ref, /^DMD\d{16}$/);
    assert.deepEqual(run.steps[2].input, { reference_no: ref, id_number: run.steps[0].output!.id_number, mobile: run.steps[0].output!.mobile });
    assert.equal(run.values.status, 'ACTIVATED');
    assert.match(out, /"password":"••••"/);
    assert.match(out, new RegExp(`ER user  ${ref} etoe\\.\\S+ · \\[Web\\] Activate`));
  });

  it('the reporter keeps each function run in history and says how to run each function on the record', () => {
    const before = new Set(readdirSync(path.join(EXAMPLE, 'out/runs')));
    const { out, run } = runFlow('example/config/flows/new-er-user.flow.json');
    const ref = run.steps[0].output!.reference_no;
    assert.match(out, new RegExp(`run: .*node src/cli.ts run example vet-er-user reference_no=${ref}`));
    const added = readdirSync(path.join(EXAMPLE, 'out/runs')).filter((id) => !before.has(id));
    const kept = added.map((id) => JSON.parse(readFileSync(path.join(EXAMPLE, 'out/runs', id, 'run.json'), 'utf8')));
    assert.deepEqual(kept.map((r) => r.project).sort(), ['activate-er-user-web', 'create-er-user', 'vet-er-user']);
    assert.ok(kept.every((r) => r.status === 'passed' && r.records[0]?.ref === ref));
    assert.ok(added.every((id) => existsSync(path.join(EXAMPLE, 'out/runs', id, 'report/index.html'))));
  });

  it('kiosk flow: the kiosk function gets its own viewport; a typed username wins', () => {
    const { code, out, run } = runFlow('example/config/flows/new-er-user-kiosk.flow.json');
    assert.equal(code, 0, out);
    assert.equal(run.values.username, 'etoe.kiosk01');
  });

  it('member flow: two steps share one page', () => {
    const { code, out, run } = runFlow('example/config/flows/new-member.flow.json');
    assert.equal(code, 0, out);
    assert.match(run.values.registration_no, /^RGD\d{16}$/);
  });

  it('a failing step stops the flow, names the portal and step, and later steps never run', () => {
    mkdirSync(path.join(EXAMPLE, '.flowkit'), { recursive: true });
    const file = path.join(EXAMPLE, '.flowkit/failing.flow.json');
    writeFileSync(file, JSON.stringify({ title: 'failing', steps: [{ function: 'create-er-user', values: { user_spec: { company: 'fail co', user_type: 'Company AP' } } }, { function: 'vet-er-user' }] }));
    const { code, out, run } = runFlow(file);
    assert.equal(code, 1);
    assert.match(out, /StepError: \[web\] Fill in the new user and submit/);
    assert.match(out, /✗ The portal refused the company/);
    assert.deepEqual(run.steps.map((s) => s.status), ['failed', 'waiting']);
  });

  it('the framework keeps the record: outputs merged, history in order', () => {
    const { run } = runFlow('example/config/flows/new-er-user.flow.json');
    const ref = run.values.reference_no;
    const record = JSON.parse(readFileSync(path.join(EXAMPLE, 'out/records/er-user', `${ref}.json`), 'utf8'));
    assert.deepEqual(record.history.map((h: { function: string }) => h.function), ['create-er-user', 'vet-er-user', 'activate-er-user-web']);
    assert.equal(record.values.status, 'ACTIVATED');
    assert.equal(record.values.mobile, run.values.mobile);
    assert.match(cli('records', 'example').stdout, new RegExp(`${ref}.*create-er-user → vet-er-user → activate-er-user-web`));
  });

  it('one function by id, given only the ref: the rest comes from its record', () => {
    const file = path.join(EXAMPLE, '.flowkit/create-vet.flow.json');
    writeFileSync(file, JSON.stringify({ steps: [{ function: 'create-er-user', values: { user_spec: { company: 'Acme', user_type: 'Company AP' } } }, { function: 'vet-er-user' }] }));
    const ref = runFlow(file).run.values.reference_no;
    const result = cli('run', 'example', 'activate-er-user-web', `reference_no=${ref}`, 'username=etoe.byref01');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const run = lastRun();
    assert.deepEqual(run.steps[0].input, { reference_no: ref, username: 'etoe.byref01' });
    assert.equal(run.values.username, 'etoe.byref01');
  });

  it('an invalid JSON input is refused before anything runs', () => {
    const file = path.join(EXAMPLE, '.flowkit/bad-spec.flow.json');
    writeFileSync(file, JSON.stringify({ steps: [{ function: 'create-er-user', values: { user_spec: { user_type: 'Boss' } } }] }));
    const result = cli('run', 'example', file);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Step 1: user_spec: company is required; user_type must be one of Company AP, Scheme AP, Other User/);
  });

  it('a bad flow is refused before anything runs', () => {
    const file = path.join(EXAMPLE, '.flowkit/bad.flow.json');
    writeFileSync(file, JSON.stringify({ steps: [{ function: 'vet-er-user', values: { reference_no: 'X' } }, { function: 'register-member' }] }));
    const result = cli('run', 'example', file);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /reference_no "X" doesn't match/);
    assert.doesNotMatch(result.stdout, /Step 2/, 'any function may come in any order');
  });
});
