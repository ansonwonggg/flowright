import { describe, it as test } from 'node:test';
import { classifyFailure, shortError, stripAnsi, type FailureRule } from '../src/failure.ts';
import { expect } from './expect.ts';

const PORTAL: FailureRule = { kind: 'portal', match: String.raw`portal error dialog|HTTP 5\d\d`, title: 'DEV returned an error', hint: 'not the automation' };
const kind = (message: string | undefined, file?: string) => classifyFailure(message, file, undefined, [PORTAL]).kind;

describe('classifyFailure', () => {
  test('a stopped run', () => expect(kind('Test was interrupted.')).toBe('stopped'));
  test('status interrupted with an empty message is stopped', () => expect(classifyFailure('', '', 'interrupted').kind).toBe('stopped'));
  test('status interrupted beats any message, and any kit rule', () => expect(classifyFailure('portal error dialog: Sorry!', '', 'interrupted', [PORTAL]).kind).toBe('stopped'));
  test('status failed still reads the message', () => expect(classifyFailure('portal error dialog: Sorry!', '', 'failed', [PORTAL]).kind).toBe('portal'));
  test('stopped wins over the timeout it may mention', () => expect(kind('Test was interrupted.\nTimeout 30000ms exceeded')).toBe('stopped'));
  test('missing .env.local value names it in the hint', () => {
    const f = classifyFailure('Error: Missing INPUTTER2_USER: set it in .env.local (see .env.example)');
    expect(f.kind).toBe('setup');
    expect(f.hint).toContain('INPUTTER2_USER');
  });
  test('invalid spec file', () => expect(kind('config/members/x.json:\n- username "ab" is too short')).toBe('input'));
  test('missing spec file', () => expect(kind("ENOENT: no such file or directory, open '/r/config/users/nope.json'")).toBe('input'));
  test("a function that can't start", () => expect(kind("vet can't start:\n- missing reference_no")).toBe('input'));
  test('any failure in a setup file is a login failure', () => expect(kind('Timeout 60000ms exceeded', '/r/setup/admin-login.setup.ts')).toBe('login'));
  test('locked account', () => expect(kind('Login failed: account is locked')).toBe('login'));
  for (const m of ['net::ERR_NAME_NOT_RESOLVED at https://x', 'connect ECONNREFUSED 1.2.3.4:443', 'getaddrinfo ENOTFOUND api-int-dev', 'socket hang up'])
    test(`network: ${m}`, () => expect(kind(m)).toBe('network'));
  test('action timeout', () => expect(kind('locator.click: Timeout 30000ms exceeded.')).toBe('timeout'));
  test('test timeout', () => expect(kind('Test timeout of 600000ms exceeded.')).toBe('timeout'));
  test('a network error inside a timeout message counts as network', () => expect(kind('Timeout 30000ms exceeded\nnet::ERR_CONNECTION_RESET')).toBe('network'));
  test('anything else is a failed check', () => expect(kind('expect(received).toBe(expected)\nExpected: "SUCCEED"')).toBe('check'));
  test('colour codes do not hide a match', () => expect(kind('\u001b[31mTimeout 30000ms exceeded\u001b[39m')).toBe('timeout'));
  test('undefined and empty messages are a failed check', () => {
    expect(kind(undefined)).toBe('check');
    expect(kind('')).toBe('check');
  });

  describe('kit rules', () => {
    test('come before the built-in ones', () => {
      const vpn: FailureRule = { kind: 'network', match: 'ECONNREFUSED', title: 'DEV could not be reached', hint: 'Check the VPN.' };
      expect(classifyFailure('connect ECONNREFUSED', '', undefined, [vpn])).toEqual({ kind: 'network', title: 'DEV could not be reached', hint: 'Check the VPN.' });
    });
    test('a kind of their own', () => expect(kind('portal error dialog: Sorry!')).toBe('portal'));
    test('without them the same message is a failed check', () => expect(classifyFailure('portal error dialog: Sorry!').kind).toBe('check'));
    test('flags apply', () => expect(classifyFailure('SORRY', '', undefined, [{ kind: 'x', match: 'sorry', flags: 'i', title: 't', hint: 'h' }]).kind).toBe('x'));
    test('$n in the hint takes the captured group, or "it"', () => {
      const rule: FailureRule = { kind: 'x', match: 'scheme "([^"]*)"( nope)?', title: 't', hint: 'fix $1, then $2' };
      expect(classifyFailure('scheme "BCT" missing', '', undefined, [rule]).hint).toBe('fix BCT, then it');
    });
    test('a file-only rule matches by path alone', () =>
      expect(classifyFailure('boom', '/r/x.portal.ts', undefined, [{ kind: 'x', file: String.raw`\.portal\.ts$`, title: 't', hint: 'h' }]).kind).toBe('x'));
    test('a rule with neither match nor file never matches', () => expect(classifyFailure('boom', '/f', undefined, [{ kind: 'x', title: 't', hint: 'h' }]).kind).toBe('check'));
  });
});

describe('shortError', () => {
  test('cuts at the call log and drops blank lines', () => expect(shortError('Error: boom\n\nExpected: 1\nCall log:\n  - waiting for x')).toBe('Error: boom\nExpected: 1'));
  test('keeps at most maxLines', () => expect(shortError('a\nb\nc\nd', 2)).toBe('a\nb'));
  test('strips colour', () => expect(shortError('\u001b[2mdim\u001b[22m')).toBe('dim'));
  test('undefined gives an empty string', () => expect(shortError(undefined)).toBe(''));
});

test('stripAnsi leaves plain text alone', () => expect(stripAnsi('plain')).toBe('plain'));
