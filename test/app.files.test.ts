import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it as test } from 'node:test';
import { needsBuild } from '../src/app/build.ts';
import { localEnv, missingEnv, withoutEnv } from '../src/app/env.ts';
import { flowLabel, listPresets, savedFlowFile } from '../src/app/presets.ts';
import { field } from '../src/fields.ts';
import type { FunctionMeta } from '../src/fn.ts';
import { expect } from './expect.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'app-'));
const write = (root: string, file: string, body: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), body);
};

describe('listPresets', () => {
  test('walks subfolders, sorts, labels by the path inside the folder, and keeps files that are not JSON', () => {
    const root = tmp();
    write(root, 'config/users/b.json', '{"creator":"ER"}');
    write(root, 'config/users/cr089/a.json', '{bad');
    write(root, 'config/users/readme.md', '#');
    expect(listPresets('users', root)).toEqual([
      { file: 'config/users/b.json', label: 'b', value: { creator: 'ER' } },
      { file: 'config/users/cr089/a.json', label: 'cr089/a', value: undefined },
    ]);
  });
  test('missing folder gives an empty list', () => expect(listPresets('nope', tmp())).toEqual([]));
});

describe('localEnv', () => {
  test('.env.local over the given env', () => {
    const root = tmp();
    write(root, '.env.local', 'A=local\nB=2\n');
    expect(localEnv(root, { A: 'env', C: '3' })).toEqual({ A: 'local', B: '2', C: '3' });
  });
  test('no file: the env alone, copied', () => {
    const env = { A: '1' };
    const got = localEnv(tmp(), env);
    expect(got).toEqual({ A: '1' });
    expect(got === env).toBe(false);
  });
});

describe('missingEnv', () => {
  const fields = {
    spec: field.json<{ creator: string }>({ label: 'Spec', env: (v) => (v?.creator ? [`${v.creator}_USER`] : []) }),
    other: field.json({ label: 'Other' }),
    ref: field.text({ label: 'Ref' }),
  };
  const fn: Pick<FunctionMeta, 'env' | 'inputs'> = { env: ['ADMIN_USER', 'A|B'], inputs: { spec: 'required', other: 'optional', ref: 'optional' } };
  test("the function's own, then what each JSON input asks for", () =>
    expect(missingEnv(fn, { spec: '{"creator":"ER"}' }, fields, {})).toEqual(['ADMIN_USER', 'A|B', 'ER_USER']));
  test('A|B is met by either; set vars are not missing', () => expect(missingEnv(fn, { spec: '{"creator":"ER"}' }, fields, { ADMIN_USER: 'x', B: 'y', ER_USER: 'z' })).toEqual([]));
  test('an empty var counts as missing', () => expect(missingEnv({ env: ['A'], inputs: {} }, {}, fields, { A: '' })).toEqual(['A']));
  test('a JSON input that is absent, not JSON, or has no env function asks for nothing', () => {
    expect(missingEnv(fn, {}, fields, { ADMIN_USER: 'x', A: 'y' })).toEqual([]);
    expect(missingEnv(fn, { spec: '{bad' }, fields, { ADMIN_USER: 'x', A: 'y' })).toEqual([]);
    expect(missingEnv(fn, { other: '{}' }, fields, { ADMIN_USER: 'x', A: 'y' })).toEqual([]);
  });
  test('a value for a name that is not an input is ignored', () => expect(missingEnv({ env: [], inputs: {} }, { spec: '{"creator":"ER"}' }, fields, {})).toEqual([]));
});

describe('withoutEnv', () => {
  test('drops each name in any letter case, keeps the rest', () =>
    expect(withoutEnv({ HTTPS_PROXY: 'a', https_proxy: 'b', Https_Proxy: 'c', PATH: '/bin' }, ['HTTPS_PROXY'])).toEqual({ PATH: '/bin' }));
  test('nothing to drop', () => expect(withoutEnv({ A: '1' }, [])).toEqual({ A: '1' }));
});

describe('needsBuild', () => {
  const ui = () => {
    const root = tmp();
    write(root, 'src/a.ts', '');
    return root;
  };
  const age = (root: string, file: string, seconds: number) => utimesSync(path.join(root, file), seconds, seconds);
  test('no built page: build', () => expect(needsBuild(ui(), [])).toBe(true));
  test('built after every source: no build', () => {
    const root = ui();
    write(root, 'dist/index.html', '');
    age(root, 'src/a.ts', 1000);
    age(root, 'dist/index.html', 2000);
    expect(needsBuild(root, [path.join(root, 'src')])).toBe(false);
  });
  test('a source newer than the page, even in a subfolder: build', () => {
    const root = ui();
    write(root, 'dist/index.html', '');
    write(root, 'src/deep/b.ts', '');
    age(root, 'dist/index.html', 2000);
    age(root, 'src/a.ts', 1000);
    age(root, 'src/deep/b.ts', 3000);
    expect(needsBuild(root, [path.join(root, 'src')])).toBe(true);
  });
  test('a source that does not exist counts as old', () => {
    const root = ui();
    write(root, 'dist/index.html', '');
    expect(needsBuild(root, [path.join(root, 'nope')])).toBe(false);
  });
});

describe('flowLabel', () => {
  test('the title, trimmed', () => expect(flowLabel('config/flows/new-er-user.flow.json', { title: '  New ER user ' })).toBe('New ER user'));
  test('no title, a blank one or a non-string one: the path inside config/flows without .flow.json', () => {
    expect(flowLabel('config/flows/new-er-user.flow.json', { steps: [] })).toBe('new-er-user');
    expect(flowLabel('config/flows/cr089/g5.flow.json', { title: ' ' })).toBe('cr089/g5');
    expect(flowLabel('config/flows/a.flow.json', { title: 7 })).toBe('a');
  });
  test('a file that is not a flow object', () => {
    expect(flowLabel('config/flows/a.flow.json', undefined)).toBe('a');
    expect(flowLabel('config/flows/a.flow.json', null)).toBe('a');
    expect(flowLabel('config/flows/a.flow.json', ['x'])).toBe('a');
  });
});

describe('savedFlowFile', () => {
  const files = ['config/flows/a.flow.json', 'config/flows/er/b.flow.json'];
  test('a saved file, in a sub-folder too', () => {
    expect(savedFlowFile('config/flows/a.flow.json', files)).toBe('config/flows/a.flow.json');
    expect(savedFlowFile('config/flows/er/b.flow.json', files)).toBe('config/flows/er/b.flow.json');
  });
  for (const bad of ['config/flows/gone.flow.json', 'a', 'config/flows/../flows/a.flow.json', ' config/flows/a.flow.json', '', undefined, null, 5, ['config/flows/a.flow.json']])
    test(`refuses ${JSON.stringify(bad)}`, () => expect(savedFlowFile(bad, files)).toBeUndefined());
  test('no saved flows: refuses everything', () => expect(savedFlowFile('config/flows/a.flow.json', [])).toBeUndefined());
});
