import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { findFiles, loadRepo, manifestOf, type Manifest, type Repo } from '../discover.ts';
import { describeEnvironment, ENV_NAME_ENV, environmentEnv, environmentFile, environmentProblem, listEnvironments, SHARED_ENV_FILE } from '../environments.ts';
import { applyEvent, emptyRun, EVENTS_ENV, parseLine, type RunView } from '../events.ts';
import { valueProblem, type Fields } from '../fields.ts';
import { flatten, flowProblems, flowSummary, fnStepAt, isIf, newFlowRun, nextStepIndex, resolveInput, secretProblems, stepEnded, stepStarted, type FlowDef, type FlowRun } from '../flow.ts';
import { listFlowRuns, readFlowRun, readOutput, writeFlowRun } from '../flowRuns.ts';
import { metaOf, type FunctionDef, type FunctionMeta } from '../fn.ts';
import { hasReport, listRuns, newRunId, readRun, RUN_ID, RUN_ID_ENV, runDir, shownStatus, writeRun, type RunRecord } from '../history.ts';
import { INPUT_ENV, OUTPUT_ENV, type Values } from '../io.ts';
import { readRecord, RECORDS_DIR } from '../records.ts';
import { describeRecord, functionsOn, listRecordViews, recordDetails, type RecordView } from '../recordView.ts';
import type { AppContext, Option, Preset } from '../settings.ts';
import { localEnv, missingEnv, runEnv } from './env.ts';
import { blockedRequest } from './guard.ts';
import { cleanFlow, filledInputs, inputProblems, presetPath, summarize } from './inputs.ts';
import { flowLabel, listPresets, savedFlowFile } from './presets.ts';

const HOST = '127.0.0.1';
const MAX_LOG = 5000;

let ROOT = process.cwd();
let DIST = '';
let REPO: Repo;
let FUNCTIONS: FunctionDef[] = [];
let METAS: FunctionMeta[] = [];
let FIELDS: Fields = {};
let MANIFEST: Manifest;
let ENV: string | undefined;

type RunEnd = { status: 'passed' | 'failed' | 'stopped'; output?: Values; error?: string };
type AppFlowRun = FlowRun & { headed?: boolean };

type Live = {
  id: string;
  fn: FunctionMeta;
  input: Values;
  env?: string;
  headed: boolean;
  startedAt: number;
  view: RunView;
  log: string[];
  child?: ChildProcess;
  stopping: boolean;
};

let live: Live | undefined;
let flow: AppFlowRun | undefined;
const listeners = new Set<ServerResponse>();

const fnOf = (id: unknown) => FUNCTIONS.find((f) => f.id === id);

const masked = (values: Values): Values => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, FIELDS[k]?.kind === 'secret' ? '••••' : v]));

const records = () => listRecordViews(METAS, ROOT);
const recordsDir = () => path.join(ROOT, RECORDS_DIR);

const recordJson = (r: RecordView) => ({
  kind: r.kind,
  key: r.key,
  stage: r.stage,
  stageLabel: r.stageLabel,
  summary: describeRecord(r, MANIFEST.settings.records),
  updatedAt: r.updatedAt,
  values: r.values,
  details: recordDetails(r, MANIFEST.fields),
  history: r.history.map((h) => h.function),
  functions: functionsOn(r.kind, METAS).map((f) => ({ id: f.id, title: f.title })),
});

const appEnv = () => (ENV ? environmentEnv(ROOT, ENV, process.env) : localEnv(ROOT));

const envMissing = (fn: FunctionMeta, values: Values): string[] => missingEnv(fn, values, FIELDS, appEnv());

const environments = () => ({
  active: ENV ?? null,
  shared: { file: SHARED_ENV_FILE, vars: describeEnvironment(ROOT, undefined, process.env) },
  environments: listEnvironments(ROOT).map((name) => ({ name, file: environmentFile(name), vars: describeEnvironment(ROOT, name, process.env) })),
});

const readFlowFile = (full: string): FlowDef | undefined => {
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch {
    return undefined;
  }
};

const presetFields = () => Object.entries(FIELDS).flatMap(([name, f]) => (f.kind === 'json' && f.presets ? [{ name, field: f, folder: f.presets }] : []));

const modifiedAt = (full: string): number | undefined => {
  try {
    return statSync(full).mtimeMs;
  } catch {
    return undefined;
  }
};

const flowFiles = () =>
  findFiles(path.join(ROOT, 'config/flows'), '.flow.json').map((full) => ({ file: path.relative(ROOT, full), spec: readFlowFile(full), modifiedAt: modifiedAt(full) }));

const presets = () => ({
  fields: Object.fromEntries(
    presetFields().map(({ name, field, folder }) => [
      name,
      listPresets(folder, ROOT).map((p) => ({ file: p.file, label: p.label, summary: p.value === undefined ? '(not valid JSON)' : (field.describe?.(p.value as never) ?? ''), spec: p.value })),
    ]),
  ),
  flows: flowFiles().map(({ file, spec, modifiedAt }) => ({ file, label: flowLabel(file, spec), summary: flowSummary(METAS, spec), spec, modifiedAt })),
});

const recordOptions = (all: RecordView[]): Record<string, Option[]> =>
  Object.fromEntries(
    Object.keys(MANIFEST.settings.records).map((kind) => [kind, all.filter((r) => r.kind === kind).map((r) => ({ value: r.key, label: describeRecord(r, MANIFEST.settings.records) }))]),
  );

const kitOptions = (context: AppContext): Record<string, Option[]> => {
  try {
    return REPO.app.options?.(context) ?? {};
  } catch (e) {
    console.warn(`The kit's app.options failed: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
};

const meta = () => {
  const all = records();
  const context: AppContext = {
    env: appEnv(),
    records: all,
    presets: Object.fromEntries(presetFields().map(({ name, folder }): [string, Preset[]] => [name, listPresets(folder, ROOT)])),
    flows: flowFiles().flatMap((f) => (f.spec ? [f.spec] : [])),
  };
  return { functions: MANIFEST.functions, fields: MANIFEST.fields, settings: MANIFEST.settings, options: { ...recordOptions(all), ...kitOptions(context) } };
};

const liveRecord = (l: Live): RunRecord => ({
  id: l.id,
  project: l.fn.id,
  title: l.fn.title,
  startedAt: l.startedAt,
  status: 'running',
  input: masked(l.input),
  ...(l.env && { env: l.env }),
  headed: l.headed,
  view: l.view,
  records: [],
});

const isLive = (id: string) => Boolean(live?.child && live.id === id);

const statusOf = (run: RunRecord) => {
  if (!isLive(run.id)) return shownStatus(run, live?.child ? live.id : undefined);
  return live?.stopping ? 'stopping' : 'running';
};

const runJson = (run: RunRecord) => {
  const input = run.input && typeof run.input === 'object' && !Array.isArray(run.input) ? run.input : {};
  return { ...run, input, status: statusOf(run), summary: summarize(input, FIELDS, REPO.app.summary), hasReport: hasReport(run.id, ROOT), live: isLive(run.id) };
};

const send = (event: string, data: unknown) => {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(chunk);
};

const liveJson = () => (live?.child ? runJson(liveRecord(live)) : null);

const handleLine = (l: Live, line: string) => {
  const parsed = parseLine(line);
  if ('event' in parsed) {
    l.view = applyEvent(l.view, parsed.event, Date.now());
    send('live', liveJson());
    return;
  }
  l.log.push(parsed.log);
  if (l.log.length > MAX_LOG) l.log.splice(0, l.log.length - MAX_LOG);
  send('log', { id: l.id, line: parsed.log });
};

const lineSplitter = (onLine: (line: string) => void) => {
  let buffer = '';
  return {
    push: (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(onLine);
    },
    flush: () => {
      if (buffer) onLine(buffer);
      buffer = '';
    },
  };
};

const settle = (l: Live, code: number | null) => {
  const saved = readRun(l.id, ROOT)?.run;
  if (saved && saved.status !== 'running') return;
  let status: RunRecord['status'] = code === 0 ? 'passed' : 'failed';
  if (l.stopping) status = 'interrupted';
  writeRun({ ...(saved ?? liveRecord(l)), status, endedAt: Date.now(), view: { ...l.view, status: l.stopping ? 'stopped' : l.view.status } }, l.log, ROOT);
};

const outputFile = (id: string) => path.join(runDir(id, ROOT), 'output.json');

const endOf = (l: Live): RunEnd => {
  const saved = readRun(l.id, ROOT)?.run.status;
  let status: RunEnd['status'] = saved === 'passed' ? 'passed' : 'failed';
  if (l.stopping || saved === 'interrupted') status = 'stopped';
  const failure = l.view.failures?.[0];
  return { status, output: readOutput(outputFile(l.id)), ...(failure && { error: [failure.title, failure.hint].filter(Boolean).join(': ') }) };
};

const startRun = (fn: FunctionMeta, input: Values, headed: boolean, onEnd?: (end: RunEnd) => void): Live => {
  const id = newRunId();
  mkdirSync(runDir(id, ROOT), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...runEnv(ROOT, ENV, process.env, MANIFEST.settings.unsetEnv),
    [INPUT_ENV]: JSON.stringify(input),
    [OUTPUT_ENV]: outputFile(id),
    [EVENTS_ENV]: '1',
    [RUN_ID_ENV]: id,
    FORCE_COLOR: '0',
  };
  const l: Live = { id, fn, input, ...(ENV && { env: ENV }), headed, startedAt: Date.now(), view: emptyRun(), log: [], stopping: false };
  const child = spawn('npx', ['playwright', 'test', `--project=${fn.id}`, ...(headed ? ['--headed'] : [])], { env, cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  l.child = child;
  const out = lineSplitter((line) => handleLine(l, line));
  const err = lineSplitter((line) => handleLine(l, line));
  child.stdout?.on('data', out.push);
  child.stderr?.on('data', err.push);
  let done = false;
  const finish = (code: number | null) => {
    if (done) return;
    done = true;
    out.flush();
    err.flush();
    settle(l, code);
    l.child = undefined;
    send('live', null);
    send('finished', { id });
    onEnd?.(endOf(l));
  };
  child.on('exit', finish);
  child.on('error', (e) => {
    handleLine(l, `Could not start Playwright: ${e.message}`);
    finish(1);
  });
  return l;
};

const stopRun = (l: Live) => {
  const child = l.child;
  if (!child?.pid) return;
  l.stopping = true;
  send('live', liveJson());
  const group = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch {
      /* already gone */
    }
  };
  group('SIGINT');
  setTimeout(() => l.child && group('SIGKILL'), 15_000).unref();
};

const prepare = (fn: FunctionMeta, values: Record<string, unknown>) => {
  const given = filledInputs(fn, values);
  const key = fn.recordKey ? given[fn.recordKey] : undefined;
  const record = fn.record && key && !fn.starts ? readRecord(recordsDir(), fn.record, key) : undefined;
  const input = filledInputs(fn, values, record);
  return {
    input,
    problems: inputProblems(fn, FIELDS, input),
    fromRecord: Object.keys(input).filter((k) => !given[k]),
    unknownRecord: Boolean(key && fn.record && !fn.starts && !record),
  };
};

const saveFlowRun = (run: FlowRun) => {
  writeFlowRun(run, ROOT);
  send('flow', run);
};

const flowWarnings = (def: FlowDef): string[] =>
  flatten(def).flatMap((step, i) => {
    if (isIf(step)) return [];
    const fn = fnOf(step.function);
    const env = fn ? envMissing(fn, (step.values ?? {}) as Values) : [];
    return env.length ? [`Step ${i + 1}: .env.local is missing ${env.join(', ')}`] : [];
  });

const advanceFlow = () => {
  const run = flow;
  if (!run) return;
  const index = nextStepIndex(run);
  if (index < 0) {
    saveFlowRun(run);
    return;
  }
  const step = fnStepAt(run, index);
  const fn = fnOf(step.function)!;
  const { input, problems } = prepare(fn, resolveInput(fn, step, run.values));
  if (problems.length) {
    flow = { ...stepEnded(stepStarted(run, index, masked(input)), { status: 'failed', error: `can't start: ${problems.join('; ')}` }, Date.now()), headed: run.headed };
    saveFlowRun(flow);
    return;
  }
  live = startRun(fn, input, run.headed === true, (end) => {
    if (flow?.id !== run.id) return;
    flow = { ...stepEnded(flow, end, Date.now()), headed: run.headed };
    advanceFlow();
  });
  flow = { ...stepStarted(run, index, masked(input), live.id), headed: run.headed };
  saveFlowRun(flow);
  send('live', liveJson());
};

const busy = () => (live?.child ? `"${live.fn.title}" is still running. Runs go one at a time: test accounts are shared.` : undefined);

const flowGoing = () => flow?.status === 'running';

const chooseEnvironment = (b: Record<string, unknown>): [number, unknown] => {
  if (busy() || flowGoing()) return [409, { error: 'Wait for the run to end: a run keeps the environment it started in.' }];
  const name = typeof b.name === 'string' && b.name ? b.name : undefined;
  const problem = name && environmentProblem(ROOT, name);
  if (problem) return [400, { error: problem }];
  ENV = name;
  send('changed', 'environment');
  return [200, { active: ENV ?? null }];
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        resolve({});
      }
    });
  });

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

const serveFile = (res: ServerResponse, file: string) => {
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>flowkit</title>
<p style="font:15px system-ui;margin:40px">The page isn't built yet. Restart <code>flowright app</code>, which builds it.</p>`;

const servePage = (res: ServerResponse, urlPath: string) => {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(DIST, rel);
  if (file.startsWith(DIST + path.sep) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file);
  const index = path.join(DIST, 'index.html');
  if (existsSync(index)) return serveFile(res, index);
  res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
  res.end(NOT_BUILT);
};

const serveReport = (res: ServerResponse, id: string, rest: string) => {
  if (!RUN_ID.test(id)) return json(res, 404, { error: 'no such run' });
  const base = path.join(runDir(id, ROOT), 'report');
  const file = path.resolve(base, decodeURIComponent(rest) || 'index.html');
  if (!file.startsWith(base + path.sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not in the report' });
  serveFile(res, file);
};

const writePreset = (file: string, body: unknown, overwrite: unknown): [number, unknown] => {
  const full = path.join(ROOT, file);
  if (existsSync(full) && overwrite !== true) return [409, { exists: true, file, error: `${file} already exists.` }];
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(body, null, 2)}\n`);
  return [200, { file }];
};

const savePreset = (b: Record<string, unknown>): [number, unknown] => {
  const name = String(b.field);
  const folder = presetFields().find((p) => p.name === name)?.folder;
  if (!folder) return [400, { error: `"${name}" has no presets folder; only a JSON field with \`presets\` can be saved.` }];
  const problem = valueProblem(name, FIELDS[name], JSON.stringify(b.value ?? null));
  if (problem) return [400, { error: `Not saved; the value is not valid: ${problem}` }];
  const target = presetPath(folder, b.name);
  return 'error' in target ? [400, target] : writePreset(target.file, b.value, b.overwrite);
};

const saveFlowPreset = (b: Record<string, unknown>): [number, unknown] => {
  const def = cleanFlow(b.flow);
  const errors = [...flowProblems(METAS, FIELDS, def), ...secretProblems(FIELDS, def)];
  if (errors.length) return [400, { error: `Not saved:\n- ${errors.join('\n- ')}` }];
  const target = presetPath('flows', b.name, '.flow.json');
  return 'error' in target ? [400, target] : writePreset(target.file, def, b.overwrite);
};

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => unknown;

const getRun: Handler = (_req, res, url) => {
  const id = url.pathname.replace(/^\/api\/runs\//, '');
  if (live?.child && live.id === id) return json(res, 200, { run: runJson(liveRecord(live)), log: live.log });
  const found = readRun(id, ROOT);
  return found ? json(res, 200, { run: runJson(found.run), log: found.log }) : json(res, 404, { error: 'No such run in history.' });
};

const checkInputs: Handler = async (req, res) => {
  const b = await readBody(req);
  const fn = fnOf(b.function);
  if (!fn) return json(res, 400, { error: 'unknown function' });
  const { input, problems, fromRecord, unknownRecord } = prepare(fn, (b.values ?? {}) as Record<string, unknown>);
  return json(res, 200, { problems, fromRecord, unknownRecord, missingEnv: envMissing(fn, input) });
};

const postRun: Handler = async (req, res) => {
  if (busy()) return json(res, 409, { error: busy() });
  const b = await readBody(req);
  const fn = fnOf(b.function);
  if (!fn) return json(res, 400, { error: `Unknown function "${String(b.function)}".` });
  const { input, problems } = prepare(fn, (b.values ?? {}) as Record<string, unknown>);
  if (problems.length) return json(res, 400, { error: `${fn.title} can't start:\n- ${problems.join('\n- ')}` });
  live = startRun(fn, input, b.headed === true);
  send('live', liveJson());
  return json(res, 202, { id: live.id });
};

const postFlowRun: Handler = async (req, res) => {
  if (busy()) return json(res, 409, { error: busy() });
  const b = await readBody(req);
  const def = cleanFlow(b.flow);
  const errors = flowProblems(METAS, FIELDS, def);
  if (errors.length) return json(res, 400, { error: `The flow can't run:\n- ${errors.join('\n- ')}` });
  const name = (typeof b.name === 'string' && b.name.trim()) || def.title || flowSummary(METAS, def);
  const file = savedFlowFile(b.file, flowFiles().map((f) => f.file));
  flow = { ...newFlowRun(METAS, def, { id: newRunId(), name, now: Date.now(), file, env: ENV }), headed: b.headed === true };
  advanceFlow();
  return json(res, 202, { id: flow.id });
};

const getFlowRun: Handler = (_req, res, url) => {
  const id = url.pathname.replace(/^\/api\/flow-runs\//, '');
  const found = flow?.id === id ? flow : readFlowRun(id, ROOT);
  return found ? json(res, 200, found) : json(res, 404, { error: 'No such flow run.' });
};

const events: Handler = (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`event: live\ndata: ${JSON.stringify(liveJson())}\n\n`);
  listeners.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    listeners.delete(res);
  });
};

const saved =
  (save: (b: Record<string, unknown>) => [number, unknown]): Handler =>
  async (req, res) => {
    const [status, body] = save(await readBody(req));
    if (status === 200) send('changed', 'presets');
    return json(res, status, body);
  };

const ROUTES: Record<string, Handler> = {
  'GET /api/meta': (_req, res) => json(res, 200, meta()),
  'GET /api/presets': (_req, res) => json(res, 200, presets()),
  'GET /api/records': (_req, res) => json(res, 200, records().map(recordJson)),
  'GET /api/history': (_req, res) => json(res, 200, listRuns(ROOT).map((r) => ({ ...runJson(r), view: { failures: r.view?.failures ?? [] } }))),
  'GET /api/live': (_req, res) => json(res, 200, liveJson()),
  'GET /api/events': events,
  'POST /api/check': checkInputs,
  'POST /api/presets': saved(savePreset),
  'POST /api/flows': saved(saveFlowPreset),
  'POST /api/run': postRun,
  'POST /api/run/stop': (_req, res) => {
    if (!live?.child) return json(res, 409, { error: 'Nothing is running.' });
    stopRun(live);
    return json(res, 202, { id: live.id });
  },
  'POST /api/flow/check': async (req, res) => {
    const def = cleanFlow((await readBody(req)).flow);
    return json(res, 200, { errors: flowProblems(METAS, FIELDS, def), warnings: flowWarnings(def) });
  },
  'POST /api/flow/run': postFlowRun,
  'GET /api/flow-runs': (_req, res) => json(res, 200, listFlowRuns(ROOT)),
  'GET /api/environments': (_req, res) => json(res, 200, environments()),
  'POST /api/environments/active': async (req, res) => {
    const [status, body] = chooseEnvironment(await readBody(req));
    return json(res, status, body);
  },
};

const routes = async (req: IncomingMessage, res: ServerResponse) => {
  const blocked = blockedRequest(req.method, req.headers);
  if (blocked) return json(res, 403, { error: blocked });
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const report = /^\/runs\/([^/]+)\/report\/(.*)$/.exec(url.pathname);
  if (report) return serveReport(res, report[1], report[2]);
  if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) return getRun(req, res, url);
  if (req.method === 'GET' && url.pathname.startsWith('/api/flow-runs/')) return getFlowRun(req, res, url);
  const handler = ROUTES[`${req.method} ${url.pathname}`];
  if (handler) return handler(req, res, url);
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  if (req.method === 'GET') return servePage(res, url.pathname);
  json(res, 404, { error: 'not found' });
};

const openInBrowser = (url: string) => {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore' }).on('error', () => {});
};

/**
 * Starts the app on `127.0.0.1:<port>` for the repo at `root`, and resolves with the running server.
 *
 * - `dataRoot`: where records, history, presets (`config/`) and `.env.local` are read and written, and
 *   where runs start; default `root`. Tests point it at a scratch copy.
 * - `env`: the environment runs start in (`.env.<env>.local` over `.env.local`); default `FLOWKIT_ENV`, else
 *   none. The page can switch it between runs.
 * - `uiDir`: the built page (`ui/dist` of flowkit).
 * - `open`: open the page in the default browser once listening.
 *
 * Loads every function file in this process, so the kit's app hooks run here. Problems with the pattern
 * are printed, not fatal.
 *
 * @throws when `env` names an environment with no file. On SIGINT or SIGTERM it stops a running function first, then exits.
 */
export const startApp = async (options: { root: string; dataRoot?: string; env?: string; port: number; uiDir: string; open: boolean }): Promise<Server> => {
  ROOT = path.resolve(options.dataRoot ?? options.root);
  ENV = options.env || process.env[ENV_NAME_ENV] || undefined;
  const envProblem = ENV && environmentProblem(ROOT, ENV);
  if (envProblem) throw new Error(envProblem);
  DIST = options.uiDir;
  REPO = await loadRepo(options.root);
  FUNCTIONS = REPO.functions.map((f) => f.def);
  METAS = FUNCTIONS.map(metaOf);
  FIELDS = REPO.fields;
  MANIFEST = manifestOf(REPO);
  const problemLines = REPO.problems.map((p) => `- ${p.file}: ${p.message}`);
  if (problemLines.length) console.warn(['flowright problems:', ...problemLines].join('\n'));
  const server = createServer((req, res) => {
    routes(req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) });
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port, HOST, resolve));
  const url = `http://localhost:${options.port}`;
  console.log(`${MANIFEST.settings.title}: ${url}  (Ctrl+C to stop)${ENV ? `  · environment ${ENV}` : ''}`);
  if (options.open) openInBrowser(url);
  const shutdown = () => {
    if (live?.child) stopRun(live);
    server.close();
    setTimeout(() => process.exit(0), live?.child ? 3000 : 0).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
};
