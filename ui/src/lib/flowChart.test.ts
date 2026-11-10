import { describe, expect, it } from 'vitest';
import { FUNCTIONS, META } from './fixtures.test-utils.ts';
import { carried, fileNameOf, flowGives, foldMissing, groupByRecord, missingInputs, slugify, splitTag, startLabel, stepErrors, toneOf } from './flowChart.ts';

describe('splitTag', () => {
  it('a leading [tag] is split off', () => expect(splitTag('[Web] Create ER User')).toEqual({ tag: 'Web', name: 'Create ER User' }));
  it('no tag, or brackets later on: the whole title', () => {
    expect(splitTag('Create user')).toEqual({ name: 'Create user' });
    expect(splitTag('Create [Web] user')).toEqual({ name: 'Create [Web] user' });
  });
  it('an empty tag or nothing after it: the whole title', () => {
    expect(splitTag('[] x')).toEqual({ name: '[] x' });
    expect(splitTag('[Web]')).toEqual({ name: '[Web]' });
  });
});

describe('toneOf', () => {
  it('the same tag always gets the same tone, ignoring case, within 0–5', () => {
    expect(toneOf('Web')).toBe(toneOf('web'));
    for (const tag of ['Web', 'Admin', 'Kiosk', 'API', 'x']) expect(toneOf(tag)).toBeGreaterThanOrEqual(0);
    for (const tag of ['Web', 'Admin', 'Kiosk', 'API', 'x']) expect(toneOf(tag)).toBeLessThan(6);
  });
  it('the usual portals get different tones', () => expect(new Set(['Web', 'Admin', 'Kiosk', 'API'].map(toneOf)).size).toBe(4));
  it('no tag: no tone', () => expect(toneOf(undefined)).toBeUndefined());
});

describe('stepErrors', () => {
  const errors = ['Step 1: needs DataMod ref', 'Step 10: unknown function "x"', 'Step 1: needs Mobile', 'flow has no steps'];
  it("the step's own errors, without the prefix", () => expect(stepErrors(errors, 0)).toEqual(['needs DataMod ref', 'needs Mobile']));
  it('step 10 is not step 1', () => expect(stepErrors(errors, 9)).toEqual(['unknown function "x"']));
  it('none', () => {
    expect(stepErrors(errors, 2)).toEqual([]);
    expect(stepErrors([], 0)).toEqual([]);
  });
});

describe('carried', () => {
  const flow = { steps: [{ function: 'create-user' }, { function: 'vet-datamod' }, { function: 'activate-api', values: { mobile: '91234567' } }] };
  it('inputs an earlier step gives and the step leaves blank', () => {
    expect(carried(FUNCTIONS, flow, 1)).toEqual(['reference_no']);
    expect(carried(FUNCTIONS, flow, 2)).toEqual(['reference_no']);
  });
  it('a typed value is not carried', () => expect(carried(FUNCTIONS, flow, 2)).not.toContain('mobile'));
  it('the first step, an unknown function, an index past the end: nothing', () => {
    expect(carried(FUNCTIONS, flow, 0)).toEqual([]);
    expect(carried(FUNCTIONS, { steps: [{ function: 'create-user' }, { function: 'nope' }] }, 1)).toEqual([]);
    expect(carried(FUNCTIONS, flow, 5)).toEqual([]);
  });
});

describe('flowGives', () => {
  it('every output once, in the order first given', () => expect(flowGives(FUNCTIONS, ['create-user', 'vet-datamod'])).toEqual(['reference_no', 'mobile', 'company', 'status']));
  it('unknown functions and an empty flow give nothing', () => {
    expect(flowGives(FUNCTIONS, ['nope'])).toEqual([]);
    expect(flowGives(FUNCTIONS, [])).toEqual([]);
  });
});

describe('startLabel', () => {
  const records = META.settings.records;
  it('a first step that makes a record: a new one', () => expect(startLabel(FUNCTIONS, ['create-user'], records)).toBe('A new ER user'));
  it('a first step on a record: an existing one', () => expect(startLabel(FUNCTIONS, ['vet-datamod'], records)).toBe('An existing ER user'));
  it('a kind the kit has no label for uses the kind', () => expect(startLabel(FUNCTIONS, ['vet-datamod'], {})).toBe('An existing er-user'));
  it('no record, an unknown function, or no steps', () => {
    expect(startLabel(FUNCTIONS, ['view-permissions'], records)).toBe('Start');
    expect(startLabel(FUNCTIONS, ['nope'], records)).toBe('Start');
    expect(startLabel(FUNCTIONS, [], records)).toBe('Start');
  });
});

describe('groupByRecord', () => {
  it('functions by record kind in the kit order, labelled; those without a record last', () =>
    expect(groupByRecord(FUNCTIONS, META.settings.records).map((g) => [g.label, g.fns.map((f) => f.id)])).toEqual([
      ['ER user', ['create-user', 'vet-datamod', 'activate-api']],
      ['member', ['member-register', 'member-enrol']],
      ['Other', ['view-permissions']],
    ]));
  it('a kind the kit does not list is kept, under its own name, before Other', () =>
    expect(groupByRecord([FUNCTIONS[0]], {}).map((g) => g.label)).toEqual(['er-user']));
  it('empty groups are left out', () => expect(groupByRecord([], META.settings.records)).toEqual([]));
});

describe('slugify', () => {
  it('a title becomes a file name', () => expect(slugify('New ER user (kiosk)')).toBe('new-er-user-kiosk'));
  it('keeps . _ - and one folder', () => expect(slugify('CR089/G5 v1.2_a')).toBe('cr089/g5-v1.2_a'));
  it('trims dashes and collapses runs; blank gives blank', () => {
    expect(slugify('  --Hello,   World!-- ')).toBe('hello-world');
    expect(slugify('   ')).toBe('');
    expect(slugify('！？')).toBe('');
  });
});

describe('fileNameOf', () => {
  it('the path inside config/flows without .flow.json', () => {
    expect(fileNameOf('config/flows/new-er-user.flow.json')).toBe('new-er-user');
    expect(fileNameOf('config/flows/cr089/g5.flow.json')).toBe('cr089/g5');
  });
  it('nothing gives blank', () => expect(fileNameOf(undefined)).toBe(''));
});

describe('missingInputs', () => {
  it('splits "<title> needs <label>" into the blank inputs; anything else stays a problem', () =>
    expect(missingInputs(['[Web] Enrol needs Scheme', 'scheme is not a code', '[Web] Enrol needs Mobile'], '[Web] Enrol')).toEqual({
      missing: ['Scheme', 'Mobile'],
      other: ['scheme is not a code'],
    }));
  it('"needs" under another title is not a blank input', () => expect(missingInputs(['the IF needs a value to test'], '[Web] Enrol')).toEqual({ missing: [], other: ['the IF needs a value to test'] }));
  it('no title (an IF) or no problems: nothing missing', () => {
    expect(missingInputs(['x needs y'], undefined)).toEqual({ missing: [], other: ['x needs y'] });
    expect(missingInputs([], 'T')).toEqual({ missing: [], other: [] });
  });
});

describe('foldMissing', () => {
  const titles = ['[Web] Enrol', '[Admin] Vet'];
  it("folds two or more blank inputs of a step into one line at the first one's place, naming three", () =>
    expect(
      foldMissing(
        ['Step 1: [Web] Enrol needs A', 'Step 1: bad scheme', 'Step 1: [Web] Enrol needs B', 'Step 1: [Web] Enrol needs C', 'Step 1: [Web] Enrol needs D', 'Step 1: [Web] Enrol needs E'],
        titles,
      ),
    ).toEqual(['Step 1: [Web] Enrol needs 5 inputs: A, B, C and 2 more', 'Step 1: bad scheme']));
  it('exactly three: all named, no "more"', () =>
    expect(foldMissing(['Step 2: [Admin] Vet needs A', 'Step 2: [Admin] Vet needs B', 'Step 2: [Admin] Vet needs C'], titles)).toEqual(['Step 2: [Admin] Vet needs 3 inputs: A, B, C']));
  it('one blank input stays as the check worded it', () => expect(foldMissing(['Step 2: [Admin] Vet needs A'], titles)).toEqual(['Step 2: [Admin] Vet needs A']));
  it('steps fold apart; lines without a step, or past the titles, pass through', () =>
    expect(foldMissing(['flow: x', 'Step 1: [Web] Enrol needs A', 'Step 2: [Admin] Vet needs B', 'Step 1: [Web] Enrol needs C', 'Step 9: T needs Z'], titles)).toEqual([
      'flow: x',
      'Step 1: [Web] Enrol needs 2 inputs: A, C',
      'Step 2: [Admin] Vet needs B',
      'Step 9: T needs Z',
    ]));
  it('no errors: none', () => expect(foldMissing([], titles)).toEqual([]));
});
