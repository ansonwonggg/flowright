#!/usr/bin/env node
import './register.ts';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { masked } from './contract.ts';
import { loadRepo, manifestOf, type Repo } from './discover.ts';
import { describeEnvironment, ENV_NAME_ENV, environmentProblem, listEnvironments, loadEnvironment, SHARED_ENV_FILE } from './environments.ts';
import { flowProblems, flowSummary, type FlowDef, type FlowRun } from './flow.ts';
import { fromRoot, metaOf, ROOT_ENV } from './fn.ts';
import { newFlow, newFunction, newStep, type Generated } from './generate.ts';
import { listRecords, RECORDS_DIR } from './records.ts';
import { runFlow } from './runner.ts';

const USAGE = `flowright <command> <root> [...]

  list <root>              the functions, steps and flows under root
  check <root>             every problem with the pattern; exits 1 when there is one
  manifest <root>          the repo as JSON (what the Playwright config and the app read)
  run <root> <flow.json>   run a flow, one function after another [--headed] [--env <name>]
  run <root> <function> [name=value ...]
                           run one function; inputs not given come from its record [--headed] [--env <name>]
  envs <root> [<name>]     the environments (.env.<name>.local), or one's vars with secrets hidden
  records <root>           the records the functions keep, newest first
  app <root> [--port 4321] [--data <dir>] [--env <name>] [--no-open]
                           the app: run functions and flows, see history and records

  new step <root> <area>/<name> [--portal web]
  new function <root> <area>/<id> --title "…" [--record kind] [--starts]
                           [--inputs a,b] [--optional c,d] [--outputs x,y]   (a record's key is added for you)
  new flow <root> <name> <function> [<function> …]

  --env <name> (or FLOWKIT_ENV=<name>) runs with .env.<name>.local on top of .env.local.`;

const printProblems = (repo: Repo) => {
  for (const p of repo.problems) console.log(`✗ ${p.file}: ${p.message}`);
};

const list = (repo: Repo) => {
  console.log('Functions');
  for (const { file, def } of repo.functions) {
    const inputs = Object.entries(def.inputs).map(([n, need]) => (need === 'required' ? `${n}*` : n));
    console.log(`  ${def.id.padEnd(26)} ${def.title}`);
    console.log(`  ${''.padEnd(26)} in: ${inputs.join(', ') || '—'}  →  out: ${def.outputs.join(', ') || '—'}   (${file})`);
  }
  console.log('Steps');
  for (const s of repo.steps) console.log(`  ${s.file}: ${s.names.join(', ')}`);
  console.log('Flows');
  const metas = repo.functions.map((f) => ({ id: f.def.id, title: f.def.id }));
  for (const f of repo.flows) console.log(`  ${f.file}: ${f.flow ? flowSummary(metas, f.flow) : '(not JSON)'}`);
  if (repo.problems.length) {
    console.log('Problems');
    printProblems(repo);
  }
};

const ICON: Record<string, string> = { waiting: '·', running: '▶', passed: '✓', failed: '✗', stopped: '■', skipped: '↷' };

const printed = new Map<number, string>();

const printRun = (repo: Repo, run: FlowRun) => {
  run.steps.forEach((step, i) => {
    if (step.status === 'waiting' || printed.get(i) === step.status) return;
    printed.set(i, step.status);
    const arm = step.taken ? ` → ${step.taken}` : '';
    console.log(`\n${ICON[step.status]} flow step ${i + 1}/${run.steps.length}: ${step.title} — ${step.status}${arm}`);
    if (step.status === 'running') console.log(`  in:  ${JSON.stringify(masked(repo.fields, step.input ?? {}))}`);
    if (step.output) console.log(`  out: ${JSON.stringify(masked(repo.fields, step.output))}`);
    if (step.error) console.log(`  ${step.error}`);
  });
};

const pairs = (args: string[]) =>
  Object.fromEntries(
    args.filter((a) => !a.startsWith('--') && a.includes('=')).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
  );

const flowOf = (repo: Repo, target: string, args: string[]): { flow: FlowDef; name: string; file?: string } => {
  if (repo.functions.some((f) => f.def.id === target) && !existsSync(target)) return { flow: { steps: [{ function: target, values: pairs(args) }] }, name: target };
  return { flow: JSON.parse(readFileSync(target, 'utf8')) as FlowDef, name: path.basename(target), file: path.relative(repo.root, path.resolve(target)) };
};

const records = (repo: Repo) => {
  const all = listRecords(fromRoot(repo.functions[0]?.def.recordsDir ?? RECORDS_DIR));
  if (!all.length) console.log('No records yet.');
  for (const r of all) {
    console.log(`${r.kind.padEnd(10)} ${r.key}   ${r.updatedAt}   ${r.history.map((h) => h.function).join(' → ')}`);
    console.log(`${''.padEnd(10)} ${JSON.stringify(masked(repo.fields, r.values))}`);
  }
};

const chosenEnvironment = (root: string, args: string[]): { env?: string; problem?: string } => {
  const env = flag(args, 'env') || process.env[ENV_NAME_ENV] || undefined;
  return { env, problem: env && environmentProblem(root, env) };
};

const run = async (repo: Repo, target: string, args: string[]) => {
  const { env, problem } = chosenEnvironment(repo.root, args);
  if (problem) {
    console.log(`✗ ${problem}`);
    return 1;
  }
  const { flow, name, file } = flowOf(repo, target, args);
  const headed = args.includes('--headed');
  const metas = repo.functions.map((f) => metaOf(f.def));
  const problems = flowProblems(metas, repo.fields, flow);
  if (problems.length) {
    for (const p of problems) console.log(`✗ ${p}`);
    return 1;
  }
  if (env) {
    process.env[ENV_NAME_ENV] = env;
    loadEnvironment(repo.root);
    console.log(`Environment: ${env} (.env.${env}.local on top of ${SHARED_ENV_FILE})`);
  }
  const result = await runFlow(repo.root, metas, flow, { name: flow.title ?? name, file, env, headed, onChange: (r) => printRun(repo, r) });
  console.log(`\nflow ${result.status}. Values: ${JSON.stringify(masked(repo.fields, result.values))}`);
  return result.status === 'passed' ? 0 : 1;
};

const envs = (root: string, name: string | undefined) => {
  const all = listEnvironments(root);
  if (!name) {
    if (!all.length) console.log(`No environments; runs use ${SHARED_ENV_FILE} alone. Add .env.<name>.local files to make some.`);
    for (const e of all) console.log(`  ${e}`);
    return 0;
  }
  const problem = environmentProblem(root, name);
  if (problem) {
    console.log(`✗ ${problem}`);
    return 1;
  }
  for (const v of describeEnvironment(root, name, process.env)) {
    let shown = v.value || '(empty)';
    if (v.secret) shown = v.set ? '•••• (set)' : '(empty)';
    console.log(`  ${v.name.padEnd(32)} ${shown.padEnd(48)} ${v.from}`);
  }
  return 0;
};

const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

const generate = async (kind: string, root: string, args: string[]): Promise<number> => {
  process.env[ROOT_ENV] = path.resolve(root);
  let made: Generated;
  try {
    if (kind === 'step') made = newStep(root, args[0] ?? '', flag(args, 'portal'));
    else if (kind === 'function')
      made = await newFunction(root, args[0] ?? '', {
        title: flag(args, 'title'),
        record: flag(args, 'record'),
        starts: args.includes('--starts'),
        inputs: flag(args, 'inputs'),
        optional: flag(args, 'optional'),
        outputs: flag(args, 'outputs'),
      });
    else if (kind === 'flow') {
      const repo = await loadRepo(root);
      made = newFlow(root, args[0] ?? '', args.slice(1), { fns: repo.functions.map((f) => metaOf(f.def)), fields: repo.fields });
    } else {
      console.log(USAGE);
      return 1;
    }
  } catch (e) {
    console.log(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  console.log(`✓ wrote ${path.relative(process.cwd(), made.file)}`);
  const problems = (await loadRepo(root)).problems.filter((p) => path.resolve(root, p.file) === made.file);
  for (const p of problems) console.log(`✗ ${p.message}`);
  for (const n of made.next) console.log(`  next: ${n}`);
  return problems.length ? 1 : 0;
};

const FLOWKIT = path.resolve(import.meta.dirname, '..');

const app = async (root: string, args: string[]): Promise<number> => {
  const ui = path.join(FLOWKIT, 'ui');
  const { buildUi } = await import('./app/build.ts');
  await buildUi(ui, [path.join(ui, 'src'), path.join(ui, 'index.html'), path.join(FLOWKIT, 'src')]);
  const { startApp } = await import('./app/server.ts');
  const env = flag(args, 'env') || process.env[ENV_NAME_ENV] || undefined;
  const problem = env && environmentProblem(path.resolve(flag(args, 'data') ?? root), env);
  if (problem) {
    console.log(`✗ ${problem}`);
    return 1;
  }
  await startApp({ root, dataRoot: flag(args, 'data'), env, port: Number(flag(args, 'port') ?? 4321), uiDir: path.join(ui, 'dist'), open: !args.includes('--no-open') });
  return 0;
};

const main = async (argv: string[]): Promise<number> => {
  if (argv[0] === 'new') return generate(argv[1] ?? '', argv[2] ?? '.', argv.slice(3));
  if (argv[0] === 'app') {
    process.env[ROOT_ENV] = path.resolve(argv[1] ?? '.');
    return app(argv[1] ?? '.', argv.slice(2));
  }
  const [command, root, ...rest] = argv;
  if (!command || !root) {
    console.log(USAGE);
    return command ? 1 : 0;
  }
  process.env[ROOT_ENV] = path.resolve(root);
  const repo = await loadRepo(root);
  if (command === 'manifest') {
    process.stdout.write(JSON.stringify(manifestOf(repo)));
    return 0;
  }
  if (command === 'list') {
    list(repo);
    return 0;
  }
  if (command === 'check') {
    printProblems(repo);
    console.log(repo.problems.length ? `${repo.problems.length} problem(s)` : `✓ ${repo.functions.length} functions, ${repo.steps.length} step files, ${repo.flows.length} flows follow the pattern`);
    return repo.problems.length ? 1 : 0;
  }
  if (command === 'run' && rest[0]) return run(repo, rest[0], rest.slice(1));
  if (command === 'envs') return envs(repo.root, rest[0]);
  if (command === 'records') {
    records(repo);
    return 0;
  }
  console.log(USAGE);
  return 1;
};

process.exitCode = await main(process.argv.slice(2));
