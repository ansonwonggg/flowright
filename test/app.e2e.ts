import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 4397;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' };

const get = async (url: string) => (await fetch(`${BASE}${url}`)).json();
const post = async (url: string, body: unknown) => {
  const res = await fetch(`${BASE}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

const waitFor = async <T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined as T);
    if (value !== undefined && done(value)) return value;
    if (Date.now() > end) throw new Error(`timed out; last: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
};

describe('flowkit app on the example repo', { timeout: 240_000 }, () => {
  let app: ChildProcess;
  let output = '';

  before(async () => {
    app = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'app', 'example', '--port', String(PORT), '--no-open'], { cwd: ROOT, env });
    app.stdout?.on('data', (c) => (output += c));
    app.stderr?.on('data', (c) => (output += c));
    await waitFor(() => get('/api/live').then(() => true), Boolean, 120_000).catch((e) => {
      throw new Error(`${e.message}\n${output}`);
    });
  });

  after(() => {
    app.kill('SIGTERM');
  });

  it("serves the built page with the kit's title", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    assert.match(html, /<div id="root">/);
    const meta = await get('/api/meta');
    assert.equal(meta.settings.title, 'Example flows');
    assert.equal(meta.functions.length, 5);
    assert.ok(Array.isArray(meta.options['er-user']), 'a list per record kind');
  });

  it('lists presets by field, described by the kit, and the saved flows', async () => {
    const presets = await get('/api/presets');
    assert.deepEqual(presets.fields.user_spec.map((p: { label: string; summary: string }) => [p.label, p.summary]), [['company-ap', 'Company AP for PCCW']]);
    assert.deepEqual(presets.flows.map((f: { label: string }) => f.label), ['New ER user (kiosk)', 'New ER user (web)', 'New member']);
  });

  it('runs a function, keeps it in history with the record it made, then fills the next one from that record', async () => {
    const started = await post('/api/run', { function: 'create-er-user', values: { user_spec: { company: 'PCCW', user_type: 'Company AP' } } });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    const { run } = await waitFor(() => get(`/api/runs/${started.body.id}`), (d) => d?.run?.status === 'passed' || d?.run?.status === 'failed', 120_000);
    assert.equal(run.status, 'passed', output);
    const ref = run.records[0]?.ref;
    assert.match(ref, /^DMD\d{16}$/);
    assert.match(run.records[0].summary, new RegExp(`^${ref} · \\[Web\\] Create ER User$`));
    const check = await post('/api/check', { function: 'activate-er-user-web', values: { reference_no: ref } });
    assert.deepEqual(check.body.problems, []);
    assert.deepEqual(check.body.fromRecord.sort(), ['id_number', 'mobile']);
    const records = await get('/api/records');
    assert.deepEqual(records.find((r: { key: string }) => r.key === ref).next.map((n: { id: string }) => n.id).sort(), ['activate-er-user-kiosk', 'activate-er-user-web', 'vet-er-user']);
  });

  it('refuses bad inputs before anything runs', async () => {
    const res = await post('/api/run', { function: 'vet-er-user', values: { reference_no: 'X' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /reference_no "X" doesn't match/);
  });
});
