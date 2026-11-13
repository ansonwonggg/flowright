# flowright

[![npm](https://img.shields.io/npm/v/@ansonwonggg/flowright)](https://www.npmjs.com/package/@ansonwonggg/flowright)
[![CI](https://github.com/ansonwonggg/flowright/actions/workflows/ci.yml/badge.svg)](https://github.com/ansonwonggg/flowright/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@ansonwonggg/flowright)](LICENSE)

Typed steps, functions and flows for Playwright automation that crosses apps, e.g. "create a user in the
web portal → approve it in the admin portal → activate it on a kiosk". The pattern is checked by the tool
rather than remembered by the team. flowright keeps the records each run makes, explains failures, and
ships a local app for running functions and building flows without touching code.

## Install

```sh
npm install --save-dev @ansonwonggg/flowright @playwright/test
```

Needs Node.js 24 or later (function files are TypeScript, loaded with Node's type stripping) and
`@playwright/test` 1.50 or later. The CLI is `flowright`:

```sh
npx flowright check .        # is every step, function and flow on the pattern?
npx flowright list .         # what's there, with inputs and outputs
npx flowright run . my.flow.json
npx flowright app .          # the local app on http://127.0.0.1:4321
```

Every `<root>` below is the folder that holds your `kit.ts` and `playwright.config.ts`.


## Three layers, one suffix each

| Layer | File | What it is |
|---|---|---|
| **Step** | `<area>/steps/<name>.step.ts` | One action on one portal, e.g. "ID number + mobile, send OTP". Typed in, typed out. Can't run alone. |
| **Function** | `<area>/<id>.fn.ts` | A runnable unit with named inputs and outputs, built from steps. One Playwright project each. |
| **Flow** | `**/<name>.flow.json` | Functions one after another, with IF branches. Outputs pass on to later inputs by name. |

Discovery goes by suffix alone: every `*.fn.ts` becomes a Playwright project, and every `*.flow.json`
is a flow. There is no list to keep in step by hand.

## The registry: every value name, once

```ts
// kit.ts, at the repo root
import { createKit, defineFields, field } from '@ansonwonggg/flowright';
import { test } from '@playwright/test';

export const fields = defineFields({
  reference_no: field.text({ label: 'DataMod ref', pattern: /^DMD\d{16}$/ }),
  mobile: field.text({ label: 'Mobile', pattern: /^\d{8}$/ }),
  id_type: field.select({ label: 'ID type', options: ['HKID'] }),
  password: field.secret({ label: 'Password' }),
  user_spec: field.json<UserSpec>({ label: 'User spec', validate: validateUserSpec, form: USER_SPEC_FORM }),
});
export const { defineFunction, defineStep, records } = createKit(fields, { test, records: { 'er-user': 'reference_no', member: 'registration_no' } });
```

Field kinds: `text` (with an optional `pattern`), `secret`, `select`, and `json` for a structured value
such as a user spec. A JSON field travels as JSON text but `run` gets it parsed and typed (`input.user_spec.company`);
its `validate` runs wherever a value is checked, and `form` is passed on for an app to draw it. In a flow
file it can be written inline as an object.

- An input or output name that isn't in the registry is a **TypeScript error**. So is returning an
  output you didn't declare. `test/types.check.ts` proves each case.
- Each value is checked against its rule when a function starts and when it ends, and when a flow is
  checked: `reference_no "X" doesn't match /^DMD\d{16}$/`.
- A `secret` is masked in logs and reports, and a flow file that holds one is refused.

## Records: the framework keeps them

`records` names each kind of record and the field that keys it. A function with `record: 'er-user'`:

- **after it passes**, has its outputs saved to `out/records/er-user/<reference_no>.json`: the values
  merged (latest wins) and a history of which function gave what, when;
- **before it starts**, gets any input it wasn't given from that record, found by its key. So
  `flowright run example activate-er-user-web reference_no=DMD…` is enough: the ID number and mobile come
  from the record.

A flow check counts a required input as given when the record could hold it: the key is known and some
function on that kind of record outputs that name. `flowright records <root>` lists them. Secrets are
saved too (a later function logs in with them), so keep `out/` git-ignored.

## A step

```ts
export const verifyIdentity = defineStep<{ page: Page }, { id_number: string; mobile: string }>({
  name: 'ID number + mobile, send OTP',
  portal: 'web',
  screenshot: 'activate-identity',          // optional: attached when the step passes
  run: async ({ page }, { id_number, mobile }) => { … },
});
```

Every step runs as a boxed `test.step` named `[web] ID number + mobile, send OTP`. Any error comes out as a
`StepError` naming the portal and step, with the original as `cause`.

## A function

```ts
// er-user/activate-er-user-web.fn.ts
export default defineFunction({
  id: 'activate-er-user-web',               // must equal the file name
  title: '[Web] Activate ER User Account',
  group: 'ER user',                         // optional: the heading the app lists it under
  record: 'er-user',                        // optional: its outputs are saved to that record, found by its key
  test,                                     // optional: a Playwright test with your fixtures
  setup: ['admin-login'],                   // optional: Playwright projects to run first
  use: { viewport: { width: 1920, height: 1080 } }, // optional, per function
  timeout: 120_000,                         // optional
  inputs: { reference_no: 'required', id_number: 'required', mobile: 'required', username: 'optional' },
  outputs: ['reference_no', 'status', 'username', 'password'],
  run: async ({ page }, input) => {         // destructure fixtures, as in any Playwright test
    await verifyIdentity({ page }, input);
    await setLogin({ page }, …);
    return { reference_no: input.reference_no, status: 'ACTIVATED', … };
  },
});
```

`starts: true` marks a function that makes a new record; it can only be a flow's first step.

`group` (a function's, or a flow file's `"group"`) puts it under that heading on the app's Home and Flows
pages, groups in the order first met. When anything has a group, the rest are listed under "Other"; when
nothing has one, the lists show with no headings. The flow builder's Save… panel edits a flow's group.

Run one function by hand, with its inputs as JSON:

```sh
FLOWKIT_INPUT='{"reference_no":"DMD…","id_number":"A123456(7)","mobile":"91234567"}' \
  npx playwright test -c example/playwright.config.ts --project=activate-er-user-web
```

Add `FLOWKIT_OUTPUT=<file>` to get its outputs as JSON.

## A flow

```json
{
  "title": "New ER user (web)",
  "group": "ER user",
  "steps": [
    { "function": "create-er-user", "values": { "company": "Acme", "user_type": "Company AP" } },
    { "function": "vet-er-user" },
    { "function": "activate-er-user-web" }
  ]
}
```

A step's input takes its typed value, else the latest earlier output with the same name, from any
earlier step. In the flow above, activation gets `id_number` and `mobile` from step 1, past step 2.

### IF

A step can branch on a value an earlier step gave:

```json
{
  "steps": [
    { "function": "member-register" },
    { "function": "member-enrol", "values": { "account_type": "SEP" } },
    { "if": { "value": "status", "equals": "NEEDS_DDE" }, "then": [{ "function": "vet-enrolment" }], "else": [] }
  ]
}
```

- The condition reads the latest value of `value`: `equals` holds when it is that text, `notEquals` when
  it isn't, and with neither it holds when the value is set. Text is trimmed, case-sensitive.
- `then` runs when it holds, `else` (optional) otherwise; the other arm's steps are `skipped`. Arms hold
  function steps only, not another IF.
- Steps are numbered flat: the IF, then its then-arm, then its else-arm. Above, the IF is step 3 and the
  vetting step 4.
- An arm step gets values from before the IF and from earlier in its own arm. After the IF, a value
  counts as given only when both arms give it.

## The Playwright config

```ts
import { defineConfig } from '@playwright/test';
import { flowkitProjects, flowkitReporters } from '@ansonwonggg/flowright/playwright';

export default defineConfig({
  testDir: import.meta.dirname,
  reporter: flowkitReporters(import.meta.dirname),
  projects: [{ name: 'admin-login', testMatch: /admin-login\.setup\.ts$/ }, ...flowkitProjects(import.meta.dirname)],
});
```

`flowkitProjects` refuses to start when a function or step file breaks the pattern, and lists why.

`flowkitReporters` gives flowright's reporter and Playwright's HTML report. After every run the reporter
prints the records the run made or changed, the functions to run on them next with the command for each,
and on failure what kind it was and what to do. It keeps each run that includes a function in
`out/runs/<id>/` (`run.json`, `log.txt`, `report/`), which the app's History reads.

## Environments

Each `.env.<name>.local` in the repo root is an environment (`.env.dev.local`, `.env.uat.local`, …). A run
in one sees `.env.local`, then that file over it, then the shell over both: put what every environment
shares in `.env.local` and only what differs (hosts, accounts) in the environment file. Flows, functions
and presets stay the same; only the values change.

- Pick one with `--env <name>` on `run` and `app`, or `FLOWKIT_ENV=<name>`. With none, runs use
  `.env.local` alone, as before. A name with no file stops the run before anything starts; a run never
  falls back to another environment.
- The app has an **Env** switch in its top bar (locked while a run goes; "none" is listed only while
  the app is in it, so start it with `--env` to keep every run in a named environment) and an **Environments** page
  listing every var of each, with the file it comes from. It only shows them; edit the files in your
  editor. Secrets (a name ending in `_PASSWORD`, `_SECRET`, `_KEY`, `_TOKEN`, `_PASSWD`, `_PWD`,
  `_CREDENTIAL(S)` or `_PASSPHRASE`) never leave the server: the page says only whether they are set.
- `npx flowright envs <root> [<name>]` prints the same in the terminal.
- Each run keeps the environment it used (`env` in `run.json` and the flow run), shown on its page and in
  History.
- The app and `flowright run` hand the vars to each run. A Playwright config started on its own loads them
  with `loadEnvironment`, in place of `dotenv.config`:

```ts
import { flowkitProjects, flowkitReporters, loadEnvironment } from '@ansonwonggg/flowright/playwright';

loadEnvironment(import.meta.dirname); // reads FLOWKIT_ENV; sets only vars the shell hasn't
```

Records are not split by environment yet: a record made on one is offered on every other.

## Kit settings

`createKit(fields, { … })` also takes what the reporter and the app show for this repo:

```ts
createKit(fields, {
  test,
  title: 'Acme flows · staging',
  records: { 'er-user': { key: 'reference_no', label: 'ER user', summary: ['{user_type}', '@ {company}', '{username}'] } },
  command: 'npm run fn --',                       // the resume line: `<command> <function> <key>=<ref>`
  unsetEnv: ['HTTPS_PROXY', 'HTTP_PROXY'],        // dropped before every app run; printed as `env -u …`
  failures: [{ kind: 'portal', match: 'Sorry!', title: 'The portal returned an error', hint: '…' }],
  app: { options: (context) => ({ creators: […] }), summary: ['reference_no', 'scheme'] },
});
```

- A record kind may still be just its key field (`{ 'er-user': 'reference_no' }`).
- `summary` parts are templates; a part with a `{name}` the record has no value for is left out.
- `failures` are tried before the built-in rules (stopped, missing `.env.local` value, input, login,
  network, timeout); `match` and `file` are regular expressions as text, so they reach the reporter.
- `app` holds functions, so it stays in the app's process. `options` gives the named lists forms use;
  each record kind is a list too, and a list named after a text field is offered as its suggestions.

A JSON field adds what the app needs for it: `form` (see `FormConfig` from `@ansonwonggg/flowright/forms`), `presets` (a folder under
`config/`), `describe` (one line for preset lists and run summaries) and `env` (env vars a value needs).
A select may give `labels` for its options.

## The app

`npx flowright app <root>` serves a local web app on 127.0.0.1:4321 (`--port`, `--no-open`,
`--data <dir>` for records, history, presets and `.env.local` somewhere else). It ships with its page built.

- **Functions:** saved flows, and every function with its saved presets. A function page shows one set of
  inputs: JSON inputs as forms (load and save presets), the rest as fields, the record key among them.
  When the key names a saved record, blank inputs are filled from it, and the page says which. It checks
  inputs and `.env.local` before a run. flowright doesn't judge which record a function should run on, or
  in what order functions should run: that is the tester's call.
- **Records:** each record with a **Run:** link for every function that takes its kind, the key filled in.
- **Flows:** a builder that offers every function and IF branches, and shows where each blank input will come from, and a page per flow run. Flow runs from the CLI appear here too (`out/flow-runs/`). The builder
  has two modes, remembered per browser: **Form** adds steps from a list at the end; **Flow chart** draws
  the flow from Start to End, with a palette grouped by kind of record. Drag a function onto any arrow, or
  a step to a new place. Each arrow shows the values handed down to the next step,
  and each step shows its own check errors. A leading `[tag]` in a function title (e.g. `[Web]`) becomes
  a coloured badge. A saved flow shows by its `title`; the builder keeps the title and the file name apart
  (the file name defaults to the title in lower case).
- **IF in the builder:** **+ Add an IF** (Form) or the IF chip (Flow chart) adds one; pick the value from
  what earlier steps give, the test (is / is not / is set) and the text, then add functions to the true and
  false branches.
- **Flow run page:** **Canvas** (default) draws the run left to right, n8n style: a node turns green with a
  ✓ when it passes, the wire into the running node marches, wires light up as values pass through them
  (labelled with how many), and an IF forks into `true` / `false` lanes with the lane not taken dashed and
  its steps skipped. Click a node for its details below the canvas; they follow the running step until
  you do. **List** shows every step at once. Either way: a running step shows its live log; a passed one
  its output; a failed or stopped one its error and log; an IF what it tested and which branch it took. A
  finished step has a **Report ↗** button that opens its Playwright report in a new tab, when one was
  kept. Each step's ⋯ menu shows its input, toggles its log, and opens its run in History.
- **Retry step N:** a failed or stopped flow run goes on from the step that ended it, in the same run.
  Steps that passed don't run again, so nothing they made is made twice; the failed step gets the same
  inputs from the values passed along. It asks first, because a step that got as far as submitting may
  already have made something. The failed go stays on the step as an earlier try (status, error, its run
  in History), and the step shows `try 2`, `try 3`… Refused while another run goes, when the app is on a
  different environment from the run's, or when a function from that step on is gone. The run keeps
  its headed / headless choice. App only: `flowright run` has no retry.
- Confirmations and errors open in the page, never as browser pop-ups.
- **Run, History, Records:** a live timeline with Stop, the failure explained, the records made and
  their logins, the Playwright report and the log.

One run at a time.

The app answers only requests addressed to `localhost` / `127.0.0.1`, and takes changes (runs, saves, the
environment) only from its own page, so another site open in the browser can't drive it.

`reporter.cts` exists for repos whose Playwright config is CommonJS (no `"type": "module"`): there
Playwright loads flowright's files as CommonJS, so the reporter has to be loaded the same way, or its named
imports break. `flowkitReporters` picks the right entry.

## Commands

| Command | What it does |
|---|---|
| `npx flowright list <root>` | functions with their inputs (`*` = required) and outputs, steps, flows |
| `npx flowright check <root>` | every pattern problem; exits 1 when there is one |
| `npx flowright run <root> <file.flow.json> [--headed] [--env <name>]` | run a flow, one Playwright run per function; kept in `<root>/out/flow-runs/` |
| `npx flowright run <root> <function> [name=value …] [--env <name>]` | run one function; inputs not given come from its record |
| `npx flowright envs <root> [<name>]` | the environments, or one's vars with secrets hidden |
| `npx flowright records <root>` | the records, newest first, with their history |
| `npx flowright new step <root> <area>/<name> [--portal web]` | a step file that fails until it is built |
| `npx flowright new function <root> <area>/<id> --title "…" [--record kind] [--starts] [--inputs a,b] [--optional c] [--outputs x,y]` | a function file; names are checked against the registry, with "did you mean"; a record's key is added for you |
| `npx flowright new flow <root> <name> <function> …` | a flow file with blanks for the values it still needs, and a list of them |
| `npx flowright manifest <root>` | the repo as JSON, for the config and an app |
| `npx flowright app <root> [--port 4321] [--data <dir>] [--env <name>] [--no-open]` | the app |

## What `check` enforces

- A `*.fn.ts` default-exports one `defineFunction`, its `id` equals the file name and is unique, it
  comes from the one shared kit, and it uses only registry names. A function on a record outputs the
  record's key when it starts one, and takes the key as an input otherwise.
- A `*.step.ts` exports only `defineStep` results. A helper belongs in another file.
- A `*.flow.json` is valid: known functions, every
  required input typed, given by an earlier step or available from the record, typed values matching
  their rules (a JSON value through its validator), no secrets. An IF tests a value an earlier step
  gives, takes at most one of `equals` / `notEquals`, has a step in at least one arm, and sits at the top
  level.

## The example

`example/` runs entirely offline against a fake portal (`example/portal/`), with the cases that make
cross-app automation hard:

| Case | Where |
|---|---|
| A saved admin login as a setup dependency | `vet-er-user` (`setup: ['admin-login']`, `use.storageState`) |
| A status that settles after a delay, with a long timeout | `vet-er-user` |
| Two steps that must share one page (session in `sessionStorage`) | `activate-er-user-web`, `register-member` |
| A page that needs a kiosk-sized viewport | `activate-er-user-kiosk` |
| Custom fixtures | every function uses `example/portal/test.ts` |

See [`DESIGN.md`](DESIGN.md) for the decisions behind the pattern.

## Developing flowright

```sh
npm ci
npx playwright install chromium
```

| Command | What it does |
|---|---|
| `npm test` | unit tests (no browser) |
| `npm run test:ui` | the app's page: components and pages with Vitest and Testing Library |
| `npm run test:example` | builds, then runs the example's flows end to end in a real browser against the fake portal, and the app on the example |
| `npm run typecheck` | `tsc`, including the type tests, and the page |
| `npm run build` | `dist/` (JS + `.d.ts`) and the app page in `ui/dist/`, which is what gets published |
| `npm run example:app` + `npm run app:dev` | the API on the example, and the page with hot reload on :5173 |

Inside this repo the CLI runs from source (`node src/cli.ts …`). The published package runs `dist/`,
because Node won't strip types from files under `node_modules`.

## Releasing

Releases go out from GitHub Actions ([`release.yml`](.github/workflows/release.yml)) when a `v*` tag is
pushed. The workflow runs the full CI first, checks the tag matches `package.json`, publishes to npm with
provenance, and creates a GitHub release with generated notes. A version with a pre-release part
(`0.2.0-beta.1`) is published under the `next` dist-tag instead of `latest`.

```sh
npm version minor            # or patch / major / prerelease --preid beta; commits and tags vX.Y.Z
git push --follow-tags
```

## License

[Apache-2.0](LICENSE)
