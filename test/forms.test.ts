import { describe, it as test } from 'node:test';
import { entryKeys, getAt, isShown, joinPath, sameSpec, setAt, shownRows, splitPath, toSpec, toValues, withSelectDefaults } from '../src/forms/engine.ts';
import type { FormConfig } from '../src/forms/types.ts';
import { expect } from './expect.ts';
import { ACCOUNTS_FORM, MEMBER_FORM, USER_FORM } from './fixtures/forms.ts';

describe('getAt / setAt', () => {
  test('reads top-level and nested keys', () => {
    expect(getAt({ a: 1 }, 'a')).toBe(1);
    expect(getAt({ a: { b: 'x' } }, 'a.b')).toBe('x');
  });
  for (const values of [null, undefined, 'x', { a: null }, { a: 'str' }, { a: [1] }])
    test(`missing path in ${JSON.stringify(values)} is undefined`, () => expect(getAt(values, 'a.b')).toBeUndefined());
  test('sets nested keys without mutating the input, creating objects', () => {
    const before = { a: { keep: 1 } };
    expect(setAt(before, 'a.b', 2)).toEqual({ a: { keep: 1, b: 2 } });
    expect(setAt({}, 'x.y', 'z')).toEqual({ x: { y: 'z' } });
    expect(setAt({ x: 'not an object' }, 'x.y', 1)).toEqual({ x: { y: 1 } });
    expect(before).toEqual({ a: { keep: 1 } });
  });
});

describe('isShown', () => {
  test('no rule: shown', () => expect(isShown(undefined, {})).toBe(true));
  test('matches one of the listed values', () => {
    expect(isShown({ userType: ['Scheme AP'] }, { userType: 'Scheme AP' })).toBe(true);
    expect(isShown({ userType: ['Scheme AP'] }, { userType: 'Other User' })).toBe(false);
    expect(isShown({ userType: ['Scheme AP'] }, {})).toBe(false);
  });
  test('every key must match', () => expect(isShown({ a: ['1'], b: ['2'] }, { a: '1', b: '3' })).toBe(false));
  test('$project compares with the project', () => {
    expect(isShown({ $project: ['member-enrol'] }, {}, 'member-enrol')).toBe(true);
    expect(isShown({ $project: ['member-enrol'] }, {}, 'member-register')).toBe(false);
  });
  test('nested keys and booleans', () => expect(isShown({ 'a.b': [true] }, { a: { b: true } })).toBe(true));
});

describe('splitPath / joinPath', () => {
  test('splits on >, trims, drops empty parts', () => expect(splitPath(' A >B>  > C ')).toEqual(['A', 'B', 'C']));
  test('empty text is no path', () => expect(splitPath('')).toEqual([]));
  test('joins with spaced >', () => expect(joinPath(['A', 'B'])).toBe('A > B'));
  for (const v of [undefined, null, 'A', 3]) test(`non-array ${JSON.stringify(v)} joins to ''`, () => expect(joinPath(v)).toBe(''));
  test('non-string parts are dropped', () => expect(joinPath(['A', 1, 'B'])).toBe('A > B'));
});

describe('toSpec: user form', () => {
  const base = { creator: 'ER', company: ' PCCW ', userType: 'Company AP' };
  test('trims text and leaves out empty and false values', () =>
    expect(toSpec(USER_FORM, { ...base, email: false, schemeAccount: '' })).toEqual({ creator: 'ER', company: 'PCCW', userType: 'Company AP' }));
  test('hidden fields are left out even when filled', () =>
    expect(toSpec(USER_FORM, { ...base, schemeAccount: 'BCT', rights: [{ control: 'company', path: ['X'], role: 'Preparer' }] })).toEqual({
      creator: 'ER',
      company: 'PCCW',
      userType: 'Company AP',
    }));
  test('Scheme AP keeps its scheme account', () =>
    expect(toSpec(USER_FORM, { ...base, userType: 'Scheme AP', schemeAccount: 'BCT' })).toMatchObject({ schemeAccount: 'BCT' }));
  test('Other User rights: path text is split, arrays kept, empty parts dropped', () =>
    expect(
      toSpec(USER_FORM, {
        ...base,
        userType: 'Other User',
        email: true,
        rights: [
          { control: 'payrollGroup', path: 'BCT > 03 >  Contribution', role: 'Approver' },
          { control: 'company', path: ['Company User Management', ''], role: 'Preparer' },
        ],
      }),
    ).toEqual({
      creator: 'ER',
      company: 'PCCW',
      userType: 'Other User',
      email: true,
      rights: [
        { control: 'payrollGroup', path: ['BCT', '03', 'Contribution'], role: 'Approver' },
        { control: 'company', path: ['Company User Management'], role: 'Preparer' },
      ],
    }));
  test('an empty list is left out, so the field validator can report it', () => expect(toSpec(USER_FORM, { ...base, userType: 'Other User', rights: [] }).rights).toBeUndefined());
  test('rights that is not an array gives no rights', () => expect(toSpec(USER_FORM, { ...base, userType: 'Other User', rights: 'x' }).rights).toBeUndefined());
});

describe('toSpec: member form', () => {
  test('keeps username and email', () =>
    expect(toSpec(MEMBER_FORM, { username: 'etoe.{stamp}', email: true }, 'member-register')).toEqual({ username: 'etoe.{stamp}', email: true }));
  test('has no enrolment: it is the enrol block\'s input', () =>
    expect(toSpec(MEMBER_FORM, { enrolment: { accountType: 'PA', scheme: 'BCT' } }, 'member-register')).toEqual({}));
});

describe('toSpec / toValues: accounts form (entries at the root)', () => {
  test('rows become the whole spec; blank rows are dropped, keys trimmed', () =>
    expect(
      toSpec(ACCOUNTS_FORM, {
        '': [
          { key: ' G1 ', value: 'DMD1' },
          { key: '', value: '' },
          { key: 'G2', value: 'DMD2' },
        ],
      }),
    ).toEqual({ G1: 'DMD1', G2: 'DMD2' }));
  test('no rows gives an empty spec', () => expect(toSpec(ACCOUNTS_FORM, {})).toEqual({}));
  test('a spec becomes rows', () => expect(toValues(ACCOUNTS_FORM, { G1: 'DMD1' })).toEqual({ '': [{ key: 'G1', value: 'DMD1' }] }));
  test('entryKeys lists the typed keys', () => expect(entryKeys({ '': [{ key: 'G1', value: '' }, { key: ' ', value: 'x' }] }, '')).toEqual(['G1']));
  test('entryKeys on missing rows is empty', () => expect(entryKeys({}, '')).toEqual([]));
});

describe('toValues', () => {
  for (const spec of [null, undefined, 'x', [1]])
    test(`non-object spec ${JSON.stringify(spec)} gives the blank form`, () => expect(toValues(USER_FORM, spec)).toEqual({ ...USER_FORM.blank, rights: [] }));
  test('does not share objects with the spec', () => {
    const spec = { creator: 'ER', rights: [{ control: 'company', path: ['A'], role: 'Preparer' }] };
    const values = toValues(USER_FORM, spec);
    (values.rights as { path: string[] }[])[0].path.push('B');
    expect(spec.rights[0].path).toEqual(['A']);
  });
  test('a form without a blank (a kit may leave it out) starts empty, with its lists empty', () => {
    const noBlank = { fields: USER_FORM.fields } as unknown as FormConfig;
    expect(toValues(noBlank, undefined)).toEqual({ rights: [] });
    expect(toValues({ ...noBlank, blank: 'x' } as unknown as FormConfig, null)).toEqual({ rights: [] });
    expect(toValues(noBlank, { creator: 'ER' })).toEqual({ creator: 'ER', rights: [] });
  });
});

describe('withSelectDefaults', () => {
  const options = { creators: [{ value: 'ER', label: 'ER' }], userTypes: [{ value: 'Company AP', label: 'Company AP' }], accountTypes: [{ value: 'PA', label: 'PA' }] };
  test('fills an empty select with its first option', () => expect(withSelectDefaults(USER_FORM, { creator: '' }, options)).toMatchObject({ creator: 'ER' }));
  test('keeps a value already set', () => expect(withSelectDefaults(USER_FORM, { creator: 'MASTER_GOV' }, options)).toMatchObject({ creator: 'MASTER_GOV' }));
  test('no options: stays empty', () => expect(withSelectDefaults(USER_FORM, { creator: '' }, {})).toMatchObject({ creator: '' }));
  test('hidden selects are not filled', () =>
    expect(getAt(withSelectDefaults(MEMBER_FORM, {}, options, 'member-register'), 'enrolment.accountType')).toBeUndefined());
  test('inline options are used too', () => {
    const form: FormConfig = { blank: {}, fields: [{ key: 'x', type: 'select', label: 'X', options: [{ value: 'a', label: 'A' }] }] };
    expect(withSelectDefaults(form, {}, {})).toEqual({ x: 'a' });
  });
});

describe('sameSpec', () => {
  test('ignores key order at every level', () => expect(sameSpec({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true));
  test('array order matters', () => expect(sameSpec({ a: [1, 2] }, { a: [2, 1] })).toBe(false));
  test('different values', () => expect(sameSpec({ a: 1 }, { a: 2 })).toBe(false));
});

describe('shownRows', () => {
  const item = { control: 'company', path: [] };
  test('pads an empty list to minRows with copies of newItem', () => {
    const rows = shownRows([], item, 1);
    expect(rows).toEqual([item]);
    rows[0].path = ['changed'];
    expect(item.path).toEqual([]);
  });
  test('keeps lists already long enough', () => expect(shownRows([{ a: 1 }, { a: 2 }], item, 1)).toEqual([{ a: 1 }, { a: 2 }]));
  test('no minRows shows the rows as they are', () => expect(shownRows([], item)).toEqual([]));
  test('non-array rows count as empty', () => expect(shownRows('x', item, 2)).toHaveLength(2));
});
