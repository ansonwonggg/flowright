import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { cleanValues, parseValues, readInput, writeOutput } from '../src/io.ts';

describe('parseValues', () => {
  it('unset or blank is {}', () => {
    assert.deepEqual(parseValues(undefined), {});
    assert.deepEqual(parseValues(' '), {});
  });
  it('keeps non-empty strings, trimmed', () => assert.deepEqual(parseValues('{"a":" x ","b":"","c":1,"d":null}'), { a: 'x' }));
  it('not JSON', () => assert.throws(() => parseValues('{bad', 'SRC'), /SRC is not JSON/));
  for (const raw of ['[]', '"x"', 'null', '1']) it(`not an object: ${raw}`, () => assert.throws(() => parseValues(raw), /must be a JSON object/));
});

it('cleanValues: objects and arrays become JSON text; other non-strings are dropped', () =>
  assert.deepEqual(cleanValues({ a: 'a', b: ' ', c: false, d: 1, e: null, f: { x: 1 }, g: [1], h: {}, i: [] }), { a: 'a', f: '{"x":1}', g: '[1]' }));
it('readInput reads FLOWKIT_INPUT', () => assert.deepEqual(readInput({ FLOWKIT_INPUT: '{"a":"1"}' }), { a: '1' }));

describe('writeOutput', () => {
  it('writes to FLOWKIT_OUTPUT', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'fk-')), 'o.json');
    writeOutput({ a: '1' }, { FLOWKIT_OUTPUT: file });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { a: '1' });
  });
  it('without it, writes nothing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fk-'));
    writeOutput({ a: '1' }, {});
    assert.equal(existsSync(path.join(dir, 'o.json')), false);
  });
});
