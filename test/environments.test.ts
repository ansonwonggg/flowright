import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it as test } from 'node:test';
import { describeEnvironment, environmentEnv, environmentProblem, isSecretName, listEnvironments, loadEnvironment } from '../src/environments.ts';
import { expect } from './expect.ts';

const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'envs-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(root, name), body);
  return root;
};

describe('listEnvironments', () => {
  test('one per .env.<name>.local, sorted; .env.local, .env.example and other files are not environments', () =>
    expect(
      listEnvironments(repo({ '.env.uat.local': '', '.env.dev.local': '', '.env.local': '', '.env.example': '', '.env.uat.example': '', 'env.qa.local': '', '.env.pre-prod_2.local': '' })),
    ).toEqual(['dev', 'pre-prod_2', 'uat']));
  test('a file whose middle is not a plain name is left out', () => expect(listEnvironments(repo({ '.env.a.b.local': '', '.env..local': '', '.env.-x.local': '' }))).toEqual([]));
  test('none, or a root that does not exist, gives []', () => {
    expect(listEnvironments(repo({}))).toEqual([]);
    expect(listEnvironments(path.join(tmpdir(), 'no-such-root-flowright'))).toEqual([]);
  });
});

describe('environmentProblem', () => {
  const root = repo({ '.env.dev.local': '', '.env.uat.local': '' });
  test('a listed environment is fine', () => expect(environmentProblem(root, 'uat')).toBeUndefined());
  test('an unknown one names the file it looked for and the ones there are', () =>
    expect(environmentProblem(root, 'sit')).toBe('No environment "sit": .env.sit.local is missing. Environments here: dev, uat.'));
  test('with none at all it says how to make one', () =>
    expect(environmentProblem(repo({}), 'uat')).toBe('No environment "uat": .env.uat.local is missing. There are none yet; add a .env.<name>.local file.'));
  for (const bad of ['../x', 'a b', '', '.', 'a.b'])
    test(`refuses the name ${JSON.stringify(bad)} without touching the disk`, () => expect(environmentProblem(root, bad)).toMatch(/not an environment name/));
});

describe('environmentEnv', () => {
  const root = repo({ '.env.local': 'A=shared\nB=shared\nC=shared\n', '.env.uat.local': 'B=uat\nD=uat\n' });
  test('the environment file over .env.local, and the given env over both', () =>
    expect(environmentEnv(root, 'uat', { C: 'shell', E: 'shell' })).toEqual({ A: 'shared', B: 'uat', C: 'shell', D: 'uat', E: 'shell' }));
  test('a shell var set to empty still wins, as dotenv leaves a var that exists', () => expect(environmentEnv(root, 'uat', { B: '' }).B).toBe(''));
  test('no environment reads .env.local alone', () => expect(environmentEnv(root, undefined, {})).toEqual({ A: 'shared', B: 'shared', C: 'shared' }));
  test('missing files read as empty', () => expect(environmentEnv(repo({}), 'uat', { X: '1' })).toEqual({ X: '1' }));
});

describe('isSecretName', () => {
  for (const name of ['ER_PASSWORD', 'password', 'DB_PASSWD', 'USER_PWD', 'DDE_SYSTEM_CLIENT_SECRET', 'API_KEY', 'KEY', 'ACCESS_TOKEN', 'TOKEN', 'SIGNING_PRIVATE_KEY', 'APP_CREDENTIALS', 'GPG_PASSPHRASE'])
    test(`${name} is a secret`, () => expect(isSecretName(name)).toBe(true));
  for (const name of ['ER_USER', 'DDE_SYSTEM_TOKEN_URL', 'DDE_SYSTEM_CLIENT_ID', 'PORTAL_BASE_URL', 'KEYBOARD_LAYOUT', 'MONKEY', 'TOKENIZER', 'PASSWORD_RULE_URL'])
    test(`${name} is not`, () => expect(isSecretName(name)).toBe(false));
});

describe('describeEnvironment', () => {
  const root = repo({ '.env.local': 'SHARED_URL=https://s\nER_PASSWORD=p1\nEMPTY=\n', '.env.uat.local': 'PORTAL_URL=https://uat\nER_PASSWORD=p2\n' });

  test('every var of both files, by name, saying which file it comes from; secrets carry no value', () =>
    expect(describeEnvironment(root, 'uat', {})).toEqual([
      { name: 'EMPTY', value: '', secret: false, set: false, from: '.env.local' },
      { name: 'ER_PASSWORD', secret: true, set: true, from: '.env.uat.local' },
      { name: 'PORTAL_URL', value: 'https://uat', secret: false, set: true, from: '.env.uat.local' },
      { name: 'SHARED_URL', value: 'https://s', secret: false, set: true, from: '.env.local' },
    ]));

  test('a var the shell sets is shown as the shell value, since the run gets that one', () =>
    expect(describeEnvironment(root, 'uat', { PORTAL_URL: 'https://shell', ER_PASSWORD: 'x', UNRELATED: 'y' })).toEqual([
      { name: 'EMPTY', value: '', secret: false, set: false, from: '.env.local' },
      { name: 'ER_PASSWORD', secret: true, set: true, from: 'shell' },
      { name: 'PORTAL_URL', value: 'https://shell', secret: false, set: true, from: 'shell' },
      { name: 'SHARED_URL', value: 'https://s', secret: false, set: true, from: '.env.local' },
    ]));

  test('no secret value is in the result in any form', () => expect(JSON.stringify(describeEnvironment(root, 'uat', { ER_PASSWORD: 'shellpass' }))).not.toMatch(/p1|p2|shellpass/));

  test('no environment lists .env.local alone', () => expect(describeEnvironment(root, undefined, {}).map((v) => v.from)).toEqual(['.env.local', '.env.local', '.env.local']));
});

describe('loadEnvironment', () => {
  const root = repo({ '.env.local': 'A=shared\nB=shared\n', '.env.uat.local': 'B=uat\nC=uat\n' });

  test('fills only the vars the env lacks, and returns the environment it loaded', () => {
    const env: NodeJS.ProcessEnv = { FLOWKIT_ENV: 'uat', C: 'shell' };
    expect(loadEnvironment(root, env)).toBe('uat');
    expect(env).toEqual({ FLOWKIT_ENV: 'uat', A: 'shared', B: 'uat', C: 'shell' });
  });

  test('with FLOWKIT_ENV unset or empty it loads .env.local alone and returns undefined', () => {
    const unset: NodeJS.ProcessEnv = {};
    expect(loadEnvironment(root, unset)).toBeUndefined();
    expect(unset).toEqual({ A: 'shared', B: 'shared' });
    const empty: NodeJS.ProcessEnv = { FLOWKIT_ENV: '' };
    expect(loadEnvironment(root, empty)).toBeUndefined();
    expect(empty.B).toBe('shared');
  });

  test('an unknown environment throws before setting anything, so a run never falls back to another one', () => {
    const env: NodeJS.ProcessEnv = { FLOWKIT_ENV: 'sit' };
    expect(() => loadEnvironment(root, env)).toThrow(/No environment "sit"/);
    expect(env).toEqual({ FLOWKIT_ENV: 'sit' });
  });
});
