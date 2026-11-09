# flowkit design notes

Status: v0.3. my-flows runs on it (migrated 2026-11-05; app, reporter and history moved into flowkit
2026-11-06), tested offline only; no DEV run yet.

## Decisions

| Decision | Why |
|---|---|
| Three layers named step / function / flow, each with a file suffix | One vocabulary from code to UI; discovery by suffix replaces the hand-kept lists in `playwright.config.ts`, `package.json` and `cli/catalog.ts`. |
| One field registry per repo, bound with `createKit` | Value names are the glue between functions. Declaring them once makes a typo a compile error and puts each value rule in one place. |
| All values are strings | They cross process boundaries as JSON env vars, and flows are JSON. Structured inputs (a list of rights) are the open question below. |
| One Playwright run per function | A function can be run, retried and reported alone; a failed flow resumes from the failed function. The cost is a new browser per function (a few seconds). |
| `defineFunction` has no side effect except under the flowkit Playwright config | The CLI and an app can import function files to read them, without Playwright complaining that `test()` was called outside a test file. The config reads the manifest in a child process, so its own module cache never holds a function file. |
| `run` destructures its fixtures, as a Playwright test does | Playwright decides which fixtures to set up by reading the test function's first parameter. flowkit hands it `run`'s signature, so custom fixtures work with no extra declaration. |
| Steps are typed with plain TypeScript, not registry names | Steps sit below the flow; their data often isn't a flow value (a page, a whole record). The registry rule applies where values cross processes: function inputs and outputs. |
| A `json` field kind for structured inputs, typed through to `run` | The user spec (with its list of rights) is one value to the flow but a typed object to the code. Its validator and form config live on the field, so every place that checks a value uses the same rules. An empty `{}` counts as not given. |
| The framework keeps the records | Every function on a record saves its outputs to it and reads missing inputs from it. That replaces the per-flow record code (`writeCreated`, `writeMember`, `userFor`, `memberFor`) with one rule, and lets a function run on a ref alone. |
| Flows are strictly linear | No conditions. A step that only applies sometimes (member DDE vetting) waits until it exists. |
| Generator writes code that fails until built | `new step` / `new function` produce files that pass `check` and typecheck, and throw "not built yet" when run, so nothing half-made can pass silently. |
| The kit is given the repo's Playwright `test`, and gives out `defineStep` | flowkit imports nothing from Playwright at run time, so a repo that links it never loads a second copy of `@playwright/test`. Step files import the repo's `kit.ts`, never flowkit. |
| `order` on a function | Lists (the app, the flow builder) follow the order people work in, not file names. |
| Problems are collected, not thrown one at a time | `check`, `can't start` and flow checks list every problem at once, so one fix-and-rerun round is enough. |
| The app, reporter, run history and record views are flowkit's | They worked the same for any repo on the pattern; only names, labels and rules differed. A repo now gives those through its kit and keeps only steps, functions, flows, `lib/` and config. |
| Kit settings are JSON; app hooks are functions | The reporter runs inside Playwright and only has the manifest, so labels, summaries, the resume command and failure rules must be JSON (regular expressions as text). Form lists and descriptions need code and run only in the app's process, which loads the repo itself. |
| Presets belong to a field (`presets: 'users'`) | A preset is a saved value of one JSON field; tying the folder to the field lets the app find, describe and validate presets with no list of its own. |
| A `.cts` reporter entry beside the `.ts` one | A CommonJS Playwright config makes Playwright load flowkit's files as CommonJS; an ES module reporter importing the same files then breaks on named imports. `flowkitReporters` picks the entry that matches how the config was loaded. |
| CLI flow runs go to `out/flow-runs/`, as app flow runs do | One list in the app, whoever started the run. |

## How my-flows maps onto it

Done. my-flows keeps `kit.ts` (fields, records, settings, app hooks), `functions/` (steps and
functions), `lib/` (page objects, bypass, DDE API, its forms and form lists), `config/` (presets and flows),
`setup/` and an app test with its own fixture (`test/app/`). Everything else is flowkit's.

## Settled

1. Structured inputs: `field.json` with a validator and form config. Built.
2. Records: kept by the framework. Built.
3. Conditional steps: not now; flows stay linear.
4. Generator: built (`flowkit new step|function|flow`).
5. Old records: start fresh. The migration doesn't convert `out/created/` or `out/members/`; they stay on
   disk, unread.

6. Record stage: the last function in its history plus its `status`.

## Known gaps

- Playwright reports a function's test location as `src/fn.ts` (where `test()` is called), not the
  `.fn.ts` file. The project name and title identify it; the report's "source" link is the only loss.
- `run` stops on Ctrl+C between functions; it doesn't kill a function mid-run itself (Playwright does on
  the same Ctrl+C).
- No JSON Schema for flow files yet.
- The generator takes flags only; there is no question-and-answer mode for testers yet.
- Playwright's HTML reporter still writes a report folder for `--list`; the run itself isn't kept in history.
- The app needs flowkit's own `node_modules` (React, Vite): run `npm install` in flowkit too.
