import { describe, it as test } from 'node:test';
import type { FieldJson } from '../src/fields.ts';
import type { FunctionMeta } from '../src/fn.ts';
import type { RecordView } from '../src/recordView.ts';
import { recordLines, resumeLine, runInput } from '../src/reporter.ts';
import { DEFAULT_SETTINGS, type KitSettings } from '../src/settings.ts';
import { expect } from './expect.ts';

const fn = (id: string, over: Partial<FunctionMeta> = {}): FunctionMeta => ({ id, title: id, detail: '', starts: false, inputs: {}, outputs: [], env: [], setup: [], ...over });
const FNS = [
  fn('create-user', { record: 'er-user', recordKey: 'reference_no', starts: true, outputs: ['reference_no'] }),
  fn('vet-datamod', { record: 'er-user', recordKey: 'reference_no', outputs: ['reference_no', 'status'] }),
  fn('activate-api', { record: 'er-user', recordKey: 'reference_no', outputs: ['reference_no', 'status', 'username'] }),
];
const SETTINGS: KitSettings = {
  ...DEFAULT_SETTINGS,
  records: { 'er-user': { key: 'reference_no', label: 'ER user', summary: ['{username}'] } },
  command: 'npm run fn --',
  unsetEnv: ['HTTPS_PROXY', 'HTTP_PROXY'],
};
const record = (history: string[], values: Record<string, string> = {}): RecordView =>
  ({ kind: 'er-user', key: 'DMD1', values, history: history.map((f) => ({ function: f, at: '', output: {} })), stage: 'x', stageLabel: 'Vet · SUCCEED' }) as unknown as RecordView;

describe('resumeLine', () => {
  test('the command with the function and its record key, after unsetting the env', () =>
    expect(resumeLine(SETTINGS, FNS[1], 'DMD1')).toBe('env -u HTTPS_PROXY -u HTTP_PROXY npm run fn -- vet-datamod reference_no=DMD1'));
  test('a function on no record takes no key', () => expect(resumeLine(SETTINGS, fn('view-permissions'), 'X')).toBe('env -u HTTPS_PROXY -u HTTP_PROXY npm run fn -- view-permissions'));
  test('nothing to unset: no env prefix', () => expect(resumeLine(DEFAULT_SETTINGS, FNS[1], 'DMD1')).toBe('npx flowkit run . vet-datamod reference_no=DMD1'));
});

describe('recordLines', () => {
  test('the record in the kit\'s words, then each function that takes it, with its command, whatever has run', () => {
    const lines = recordLines(record(['create-user', 'vet-datamod']), FNS, SETTINGS);
    expect(lines[0]).toContain('ER user  DMD1 · Vet · SUCCEED');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('npm run fn -- vet-datamod reference_no=DMD1');
    expect(lines[2]).toContain('npm run fn -- activate-api reference_no=DMD1');
  });
  test("the kit's summary parts follow the key; what the record already holds doesn't hide a function", () => {
    const lines = recordLines(record(['create-user', 'vet-datamod'], { username: 'etoe.a' }), FNS, SETTINGS);
    expect(lines[0]).toBe('  ER user  DMD1 etoe.a · Vet · SUCCEED');
    expect(lines).toHaveLength(3);
  });
  test('a kind no function takes has a single line, and shows as itself without a label', () => {
    const lines = recordLines({ ...record([]), kind: 'thing' }, FNS, SETTINGS);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('thing    DMD1 · Vet · SUCCEED');
  });
});

describe('runInput', () => {
  const fields: FieldJson[] = [
    { name: 'password', kind: 'secret', label: 'Password' },
    { name: 'mobile', kind: 'text', label: 'Mobile' },
  ];
  test('the inputs, with secrets masked', () =>
    expect(runInput({ FLOWKIT_INPUT: '{"mobile":"9","password":"pw","other":"o"}' }, fields)).toEqual({ mobile: '9', password: '••••', other: 'o' }));
  test('unset, blank or not JSON: {}', () => {
    expect(runInput({}, fields)).toEqual({});
    expect(runInput({ FLOWKIT_INPUT: ' ' }, fields)).toEqual({});
    expect(runInput({ FLOWKIT_INPUT: '{bad' }, fields)).toEqual({});
  });
});
