/**
 * A failure explained for a tester: what kind it is, a one-line title, and what to do about it. The
 * built-in kinds are `stopped`, `setup`, `input`, `login`, `network`, `timeout` and `check`; a kit may add its own.
 */
export type Failure = { kind: string; title: string; hint: string };

/**
 * One way to recognise a failure, as JSON so it can live in the kit and reach the reporter.
 *
 * - `match`: a regular expression (source text) tried on the error message.
 * - `file`: a regular expression tried on the failing test's file path; either one matching is enough.
 * - `hint`: `$1`…`$9` are replaced with the groups `match` captured (`it` when a group is missing).
 */
export type FailureRule = { kind: string; match?: string; flags?: string; file?: string; title: string; hint: string };

const ANSI = /\u001b\[[0-9;]*m/g;

/** `message` without terminal colour codes. */
export const stripAnsi = (message: string): string => message.replace(ANSI, '');

/**
 * The first `maxLines` meaningful lines of a Playwright error: colour codes, the call log and blank
 * lines removed. Empty input gives `''`.
 */
export const shortError = (message: string | undefined, maxLines = 8): string =>
  stripAnsi(message ?? '')
    .split('\n')
    .reduce<{ lines: string[]; done: boolean }>(
      (acc, line) => (acc.done || /^\s*Call log:/.test(line) ? { ...acc, done: true } : { ...acc, lines: [...acc.lines, line] }),
      { lines: [], done: false },
    )
    .lines.filter((line) => line.trim())
    .slice(0, maxLines)
    .join('\n');

const STOPPED: FailureRule = {
  kind: 'stopped',
  match: String.raw`Test was interrupted|Target page, context or browser has been closed[\s\S]*interrupted`,
  flags: 'i',
  title: 'The run was stopped',
  hint: 'Someone stopped it before it finished. Whatever the site already accepted stays there; check Records for anything half-made.',
};

/** The rules every repo gets, tried after the kit's own, in this order. Anything none matches is a failed check. */
export const BUILT_IN_FAILURES: FailureRule[] = [
  STOPPED,
  {
    kind: 'setup',
    match: String.raw`Missing (\w+): set it in \.env\.local`,
    title: 'A setting is missing from .env.local',
    hint: 'Add $1 to .env.local (names are in .env.example), then run again.',
  },
  {
    kind: 'input',
    match: String.raw`ENOENT[^\n]*config\/|config\/[^\s:]+\.json:\n-|can't start:`,
    title: 'The chosen spec or input is not usable',
    hint: 'Fix the input named below. Nothing was created if this happened before the first step.',
  },
  {
    kind: 'login',
    match: String.raw`\blog ?in\b[^\n]*(fail|invalid|locked)|account is locked|incorrect (username|password)`,
    flags: 'i',
    file: String.raw`\.setup\.ts$`,
    title: 'A login failed',
    hint: 'Check the account in .env.local before running again. Each failed login burns one of the lockout attempts, so do not retry blindly.',
  },
  {
    kind: 'network',
    match: 'net::ERR_|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|socket hang up|getaddrinfo',
    title: 'The site could not be reached',
    hint: 'Check the network, VPN and proxy settings, then run again.',
  },
  {
    kind: 'timeout',
    match: String.raw`Timeout \d+ms exceeded|Test timeout of \d+ms|timed out`,
    flags: 'i',
    title: 'The site did not reach the expected screen or status in time',
    hint: 'The site may be slow, or a screen may have changed. Open the report to see the last screenshot and the trace.',
  },
];

const CHECK: Failure = {
  kind: 'check',
  title: 'A check failed',
  hint: 'This can be a real defect or a screen that changed. Compare the screenshot in the report with what the step expected.',
};

const tryRule = (rule: FailureRule, text: string, file: string): Failure | undefined => {
  const found = rule.match ? new RegExp(rule.match, rule.flags).exec(text) : null;
  if (!found && !(rule.file && new RegExp(rule.file).test(file))) return undefined;
  return { kind: rule.kind, title: rule.title, hint: rule.hint.replace(/\$(\d)/g, (_, n: string) => found?.[Number(n)] ?? 'it') };
};

/**
 * Explains a failed run from its error message.
 *
 * Tries the kit's `rules` first, then {@link BUILT_IN_FAILURES}; anything else is a failed check, which
 * may be a real defect or a changed screen.
 *
 * @param file - the failing test's file path; a failure in a `*.setup.ts` file counts as a login failure.
 * @param status - the test's Playwright status. `interrupted` (Ctrl+C or Stop) is always a stopped run;
 *   its message is usually empty.
 * @param rules - the kit's own rules; a bad regular expression in one throws.
 */
export const classifyFailure = (message: string | undefined, file = '', status?: string, rules: FailureRule[] = []): Failure => {
  const text = stripAnsi(message ?? '');
  if (status === 'interrupted') return { kind: STOPPED.kind, title: STOPPED.title, hint: STOPPED.hint };
  for (const rule of [...rules, ...BUILT_IN_FAILURES]) {
    const found = tryRule(rule, text, file);
    if (found) return found;
  }
  return CHECK;
};
