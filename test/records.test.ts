import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fillFromRecord, listRecords, readRecord, recordPath, saveRecord } from '../src/records.ts';

const dir = () => mkdtempSync(path.join(tmpdir(), 'records-'));
const at = (s: number) => new Date(Date.UTC(2026, 10, 5, 0, 0, s));

describe('recordPath', () => {
  it('kind folder, key file', () => assert.equal(recordPath('/r', 'er-user', 'DMD1'), '/r/er-user/DMD1.json'));
  for (const kind of ['ER', '../x', 'a b', '']) it(`refuses kind "${kind}"`, () => assert.throws(() => recordPath('/r', kind, 'K'), /must be kebab-case/));
  for (const key of ['../x', 'a/b', '', '.hidden']) it(`refuses key "${key}"`, () => assert.throws(() => recordPath('/r', 'k', key), /may only hold/));
});

describe('saveRecord / readRecord', () => {
  it('creates, then merges values (latest wins) and appends history', () => {
    const d = dir();
    saveRecord(d, { kind: 'er-user', key: 'DMD1', fn: 'create', output: { reference_no: 'DMD1', mobile: '9' }, now: at(1) });
    const r = saveRecord(d, { kind: 'er-user', key: 'DMD1', fn: 'activate', output: { mobile: '8', username: 'u' }, now: at(2) });
    assert.deepEqual(r, readRecord(d, 'er-user', 'DMD1'));
    assert.deepEqual(r.values, { reference_no: 'DMD1', mobile: '8', username: 'u' });
    assert.equal(r.createdAt, at(1).toISOString());
    assert.equal(r.updatedAt, at(2).toISOString());
    assert.deepEqual(r.history.map((h) => [h.function, h.output]), [['create', { reference_no: 'DMD1', mobile: '9' }], ['activate', { mobile: '8', username: 'u' }]]);
  });
  it('missing, unkeyed, malformed key or broken file reads as undefined', () => {
    const d = dir();
    assert.equal(readRecord(d, 'er-user', 'NONE'), undefined);
    assert.equal(readRecord(d, 'er-user', undefined), undefined);
    assert.equal(readRecord(d, 'er-user', '../x'), undefined);
    mkdirSync(path.join(d, 'er-user'));
    writeFileSync(path.join(d, 'er-user/BAD.json'), '{bad');
    assert.equal(readRecord(d, 'er-user', 'BAD'), undefined);
  });
});

describe('listRecords', () => {
  it('newest first across kinds; skips what isn\'t a record', () => {
    const d = dir();
    saveRecord(d, { kind: 'er-user', key: 'A', fn: 'f', output: {}, now: at(1) });
    saveRecord(d, { kind: 'member', key: 'B', fn: 'f', output: {}, now: at(3) });
    saveRecord(d, { kind: 'er-user', key: 'C', fn: 'f', output: {}, now: at(2) });
    writeFileSync(path.join(d, 'er-user/notes.txt'), 'x');
    writeFileSync(path.join(d, 'er-user/D.json'), '{"no":"values"}');
    writeFileSync(path.join(d, 'stray.json'), '{}');
    mkdirSync(path.join(d, 'Bad Kind'));
    assert.deepEqual(listRecords(d).map((r) => r.key), ['B', 'C', 'A']);
  });
  it('no folder: nothing', () => assert.deepEqual(listRecords('/no/such/dir'), []));
});

describe('fillFromRecord', () => {
  const record = { kind: 'k', key: 'K', createdAt: '', updatedAt: '', history: [], values: { ref: 'K', mobile: '9', other: 'o' } };
  it('fills only declared inputs that are missing or blank', () =>
    assert.deepEqual(fillFromRecord({ ref: 'required', mobile: 'required', name: 'optional' }, { ref: 'K', mobile: ' ' }, record), { ref: 'K', mobile: '9' }));
  it('a given value wins', () => assert.deepEqual(fillFromRecord({ mobile: 'required' }, { mobile: '8' }, record), { mobile: '8' }));
  it('no record: as given', () => {
    const raw = { a: '1' };
    assert.equal(fillFromRecord({ a: 'required' }, raw, undefined), raw);
  });
});
