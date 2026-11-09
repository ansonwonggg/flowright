import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it as test } from 'node:test';
import { expect } from './expect.ts';
import type { FieldJson } from '../src/fields.ts';
import { saveRecord, type RecordFile } from '../src/records.ts';
import { changedRecords, describeRecord, kindLabel, listRecordViews, nextForRecord, recordDetails, snapshotRecords, stageOf, type RecordView } from '../src/recordView.ts';
import type { RecordKind } from '../src/settings.ts';

const FNS = [
  { id: 'create-user', title: 'Create', record: 'er-user', recordKey: 'reference_no', starts: true, outputs: ['reference_no', 'mobile'] },
  { id: 'vet-datamod', title: 'Vet', record: 'er-user', recordKey: 'reference_no', starts: false, outputs: ['reference_no', 'status'] },
  { id: 'activate-api', title: 'Activate', record: 'er-user', recordKey: 'reference_no', starts: false, outputs: ['reference_no', 'status', 'username', 'password'] },
  { id: 'member-enrol', title: 'Enrol', record: 'member', recordKey: 'registration_no', starts: false, outputs: ['enrolment_no', 'status'] },
];
const rec = (over: Partial<RecordView> = {}): RecordView => ({
  kind: 'er-user',
  key: 'DMD1',
  createdAt: '',
  updatedAt: 't1',
  values: {},
  history: [],
  stage: 'new',
  stageLabel: 'new',
  ...over,
});
const at = (fn: string) => ({ function: fn, at: '', output: {} });

describe('stageOf', () => {
  test('last function with the status it left', () =>
    expect(stageOf({ history: [at('create-user'), at('vet-datamod')], values: { status: 'SUCCEED' } }, FNS)).toEqual({ stage: 'vet-datamod', stageLabel: 'Vet · SUCCEED' }));
  test('without a status, just the title', () => expect(stageOf({ history: [at('vet-datamod')], values: {} }, FNS)).toEqual({ stage: 'vet-datamod', stageLabel: 'Vet' }));
  test('an unknown function keeps its id', () => expect(stageOf({ history: [at('gone')], values: {} }, FNS).stageLabel).toBe('gone'));
  test('no history, or not a list, is new', () => {
    expect(stageOf({ history: [], values: {} }, FNS)).toEqual({ stage: 'new', stageLabel: 'new' });
    expect(stageOf({ history: null as never, values: null as never }, FNS)).toEqual({ stage: 'new', stageLabel: 'new' });
  });
});

describe('listRecordViews', () => {
  test('reads out/records under the root, newest first, with stages', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'records-'));
    const dir = path.join(root, 'out/records');
    saveRecord(dir, { kind: 'er-user', key: 'DMD1', fn: 'create-user', output: { status: 'SUBMITTED' }, now: new Date(1000) });
    saveRecord(dir, { kind: 'member', key: 'RGD1', fn: 'member-enrol', output: {}, now: new Date(2000) });
    expect(listRecordViews(FNS, root).map((r) => [r.key, r.stageLabel])).toEqual([
      ['RGD1', 'Enrol'],
      ['DMD1', 'Create · SUBMITTED'],
    ]);
  });
  test('no folder: nothing', () => expect(listRecordViews(FNS, mkdtempSync(path.join(tmpdir(), 'records-')))).toEqual([]));
});

describe('describeRecord', () => {
  const KINDS: Record<string, RecordKind> = {
    'er-user': { key: 'reference_no', label: 'ER user', summary: ['{user_type}', '@ {company}', '{username}'] },
    member: { key: 'registration_no', label: 'member', summary: ['Member {member_id}', '{username}'] },
  };
  test('every summary part with its values', () =>
    expect(describeRecord(rec({ values: { user_type: 'Company AP', company: 'PCCW', username: 'etoe.a' }, stageLabel: 'Activate · ACTIVATED' }), KINDS)).toBe(
      'DMD1 Company AP @ PCCW etoe.a · Activate · ACTIVATED',
    ));
  test('a part missing any of its values is left out', () =>
    expect(describeRecord(rec({ kind: 'member', key: 'RGD1', values: { member_id: '2026' } }), KINDS)).toBe('RGD1 Member 2026 · new'));
  test('a part with two names needs both', () =>
    expect(describeRecord(rec({ values: { a: 'x' } }), { 'er-user': { key: 'k', label: 'l', summary: ['{a}/{b}'] } })).toBe('DMD1 · new'));
  test('a part with no names is always shown', () => expect(describeRecord(rec(), { 'er-user': { key: 'k', label: 'l', summary: ['fixed'] } })).toBe('DMD1 fixed · new'));
  test('nothing but a key: values or settings may be missing', () => {
    expect(describeRecord(rec(), KINDS)).toBe('DMD1 · new');
    expect(describeRecord(rec({ values: null as never }), KINDS)).toBe('DMD1 · new');
    expect(describeRecord(rec({ values: { user_type: 'x' } }))).toBe('DMD1 · new');
    expect(describeRecord(rec({ kind: 'other' }), KINDS)).toBe('DMD1 · new');
  });
});

describe('kindLabel', () => {
  test('the label, else the kind', () => {
    expect(kindLabel('er-user', { 'er-user': { key: 'k', label: 'ER user', summary: [] } })).toBe('ER user');
    expect(kindLabel('member', { 'er-user': { key: 'k', label: 'ER user', summary: [] } })).toBe('member');
    expect(kindLabel('member')).toBe('member');
  });
});

describe('recordDetails', () => {
  const fields: FieldJson[] = [
    { name: 'reference_no', kind: 'text', label: 'DataMod ref' },
    { name: 'password', kind: 'secret', label: 'Password' },
    { name: 'mobile', kind: 'text', label: 'Mobile' },
  ];
  test('stage first, then registry order, then names the registry lacks; empty values left out', () =>
    expect(recordDetails(rec({ values: { mobile: '9', reference_no: 'DMD1', password: 'pw', legacy: 'x', blank: '' }, stageLabel: 'Vet' }), fields)).toEqual([
      ['Stage', 'Vet'],
      ['DataMod ref', 'DMD1'],
      ['Password', 'pw'],
      ['Mobile', '9'],
      ['legacy', 'x'],
    ]));
  test('no values: only the stage', () => expect(recordDetails(rec({ values: null as never }), fields)).toEqual([['Stage', 'new']]));
});

describe('nextForRecord', () => {
  const ids = (list: { id: string }[]) => list.map((f) => f.id);
  test('same kind, not starting, not run yet', () => expect(ids(nextForRecord(rec({ history: [at('create-user')] }), FNS))).toEqual(['vet-datamod', 'activate-api']));
  test('drops what already ran', () => expect(ids(nextForRecord(rec({ history: [at('create-user'), at('vet-datamod')] }), FNS))).toEqual(['activate-api']));
  test('other kinds', () => expect(ids(nextForRecord(rec({ kind: 'member' }), FNS))).toEqual(['member-enrol']));
  test('missing history and values count as none', () => expect(nextForRecord(rec({ history: undefined as never, values: undefined as never }), FNS)).toHaveLength(2));
  test('drops a function whose own outputs the record already holds, e.g. another activation gave the login', () =>
    expect(ids(nextForRecord(rec({ history: [at('create-user'), at('activate-web')], values: { username: 'u', password: 'p' } }), FNS))).toEqual(['vet-datamod']));
  test('holding only some of them, or only the key and status, keeps it', () => {
    expect(ids(nextForRecord(rec({ values: { username: 'u' } }), FNS))).toEqual(['vet-datamod', 'activate-api']);
    expect(ids(nextForRecord(rec({ values: { reference_no: 'DMD1', status: 'SUCCEED' } }), FNS))).toEqual(['vet-datamod', 'activate-api']);
  });
});

describe('snapshotRecords / changedRecords', () => {
  const r = (key: string, updatedAt: string) => ({ kind: 'er-user', key, updatedAt }) as RecordFile;
  test('new and changed records, in the order given', () => {
    const before = snapshotRecords([r('a', '1'), r('b', '2')]);
    expect(changedRecords(before, [r('c', '5'), r('b', '3'), r('a', '1')]).map((x) => x.key)).toEqual(['c', 'b']);
  });
  test('same key in another kind is another record', () =>
    expect(changedRecords(snapshotRecords([r('a', '1')]), [{ ...r('a', '1'), kind: 'member' }])).toHaveLength(1));
  test('an empty snapshot counts everything; deleted ones are not reported', () => {
    expect(changedRecords(new Map(), [r('a', '1')])).toHaveLength(1);
    expect(changedRecords(snapshotRecords([r('gone', '1')]), [])).toEqual([]);
  });
});
