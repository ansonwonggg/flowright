import { describe, expect, it } from 'vitest';
import type { FieldJson } from '../api.ts';
import { FIELDS, FUNCTIONS } from './fixtures.test-utils.ts';
import {
  allSteps,
  draftFrom,
  dropGaps,
  flatIndexes,
  flowOf,
  groupOf,
  isDraftIf,
  newIf,
  removeKey,
  replaceStep,
  testableBefore,
  titleOf,
  formOf,
  inputSource,
  insertAt,
  moveTo,
  newStep,
  placeholderFor,
  updateIf,
  type DraftIf,
} from './flowDraft.ts';

const options = { creators: [{ value: 'ER', label: 'ER' }], userTypes: [{ value: 'Company AP', label: 'Company AP' }] };
const fieldOf = (name: string) => FIELDS.find((f) => f.name === name)!;
const userSpec = { creator: 'ER', company: 'Acme', userType: 'Company AP' };

describe('formOf', () => {
  it('a JSON field with a form config', () => expect(formOf(fieldOf('user_spec'))?.blank).toEqual({ creator: '', company: '', userType: 'Company AP' }));
  it('no form for text fields, a JSON field without one, or nothing', () => {
    expect(formOf(fieldOf('mobile'))).toBeUndefined();
    expect(formOf({ name: 'x', kind: 'json', label: 'X' })).toBeUndefined();
    expect(formOf({ name: 'x', kind: 'json', label: 'X', form: 'nope' } as FieldJson)).toBeUndefined();
    expect(formOf(undefined)).toBeUndefined();
  });
});

describe('newStep', () => {
  it('a JSON input starts from its blank form with select defaults', () => {
    const step = newStep(FUNCTIONS, FIELDS, 'create-user', options);
    expect(step).toMatchObject({ fn: 'create-user', values: {}, forms: { user_spec: { creator: 'ER', userType: 'Company AP' } } });
    expect(step.key).toBeTruthy();
  });
  it('a function without JSON inputs has no forms', () => expect(newStep(FUNCTIONS, FIELDS, 'vet-datamod', options).forms).toEqual({}));
  it('each step gets its own key', () => expect(newStep(FUNCTIONS, FIELDS, 'vet-datamod', options).key).not.toBe(newStep(FUNCTIONS, FIELDS, 'vet-datamod', options).key));
  it('an unknown function has no forms', () => expect(newStep(FUNCTIONS, FIELDS, 'nope', options).forms).toEqual({}));
});

describe('draftFrom / flowOf', () => {
  it('a saved flow comes back unchanged', () => {
    const def = {
      title: 'T',
      steps: [{ function: 'create-user', values: { user_spec: userSpec } }, { function: 'vet-datamod' }, { function: 'activate-api', values: { username: 'etoe.me' } }],
    };
    expect(flowOf(draftFrom(FUNCTIONS, FIELDS, def, options), FIELDS, 'T')).toEqual(def);
  });
  it('text values that are blank are dropped; a JSON input that comes out empty is left out', () =>
    expect(flowOf([{ key: 'k', fn: 'member-register', values: { mobile: ' ' }, forms: { member_spec: {} } }], FIELDS)).toEqual({ steps: [{ function: 'member-register' }] }));
  it('a blank title is left out', () => expect(flowOf([], FIELDS, '  ')).toEqual({ steps: [] }));
  it('a group is kept, trimmed; a blank one is left out', () => {
    expect(flowOf([], FIELDS, 'T', ' Member ')).toEqual({ title: 'T', group: 'Member', steps: [] });
    expect(flowOf([], FIELDS, '', '  ')).toEqual({ steps: [] });
  });
  it('unknown functions and non-string values: kept as functions, values dropped', () =>
    expect(draftFrom(FUNCTIONS, FIELDS, { steps: [{ function: 'nope', values: { a: 1, b: 'x' } }] }, options)).toMatchObject([{ fn: 'nope', values: { b: 'x' }, forms: {} }]));
  for (const def of [undefined, null, {}, { steps: 'x' }]) it(`no steps in ${JSON.stringify(def)}`, () => expect(draftFrom(FUNCTIONS, FIELDS, def, options)).toEqual([]));
});

describe('placeholderFor', () => {
  const flow = { steps: [{ function: 'create-user', values: { user_spec: '{}' } }, { function: 'vet-datamod' }, { function: 'activate-api' }] };
  it('an earlier output says which step', () => expect(placeholderFor(FUNCTIONS, flow, 2, fieldOf('reference_no'), true)).toBe('from step 1'));
  it('a value the record can hold says so once the key is known', () =>
    expect(placeholderFor(FUNCTIONS, { steps: [{ function: 'activate-api', values: { reference_no: 'DMD1' } }] }, 0, fieldOf('mobile'), true)).toBe('from the record'));
  it('an optional input never claims the record; it shows its default', () =>
    expect(placeholderFor(FUNCTIONS, { steps: [{ function: 'activate-api', values: { reference_no: 'DMD1' } }] }, 0, fieldOf('username'), false)).toBe('etoe.<stamp>'));
  it('inputSource names the step, or the record, or nothing', () => {
    expect(inputSource(FUNCTIONS, flow, 2, 'reference_no', true)).toEqual({ step: 1 });
    expect(inputSource(FUNCTIONS, { steps: [{ function: 'activate-api', values: { reference_no: 'DMD1' } }] }, 0, 'mobile', true)).toEqual({ record: true });
    expect(inputSource(FUNCTIONS, { steps: [{ function: 'activate-api' }] }, 0, 'mobile', true)).toEqual({});
  });
  it('else the field placeholder, then "required", then nothing', () => {
    expect(placeholderFor(FUNCTIONS, { steps: [{ function: 'activate-api' }] }, 0, fieldOf('mobile'), true)).toBe('8 digits');
    expect(placeholderFor(FUNCTIONS, { steps: [{ function: 'member-enrol' }] }, 0, fieldOf('scheme'), true)).toBe('required');
    expect(placeholderFor(FUNCTIONS, { steps: [{ function: 'view-permissions' }] }, 0, fieldOf('view_as'), false)).toBe('');
  });
});

describe('moveTo', () => {
  const list = ['a', 'b', 'c'];
  it('down: the item lands before the gap it was dropped on', () => expect(moveTo(list, 0, 2)).toEqual(['b', 'a', 'c']));
  it('to the end', () => expect(moveTo(list, 0, 3)).toEqual(['b', 'c', 'a']));
  it('up, to the start', () => expect(moveTo(list, 2, 0)).toEqual(['c', 'a', 'b']));
  it('onto either gap beside itself: unchanged', () => {
    expect(moveTo(list, 1, 1)).toEqual(list);
    expect(moveTo(list, 1, 2)).toEqual(list);
  });
  it('a gap out of range is clamped; the input is not mutated', () => {
    expect(moveTo(list, 0, 9)).toEqual(['b', 'c', 'a']);
    expect(moveTo(list, 2, -1)).toEqual(['c', 'a', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('an index out of range: unchanged', () => expect(moveTo(list, 5, 0)).toEqual(list));
});

describe('insertAt', () => {
  it('start, middle, end', () => {
    expect(insertAt(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b']);
    expect(insertAt(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    expect(insertAt(['a', 'b'], 'x', 2)).toEqual(['a', 'b', 'x']);
  });
  it('into an empty list; a gap out of range is clamped', () => {
    expect(insertAt([], 'x', 0)).toEqual(['x']);
    expect(insertAt(['a'], 'x', 9)).toEqual(['a', 'x']);
    expect(insertAt(['a'], 'x', -3)).toEqual(['x', 'a']);
  });
});

describe('dropGaps', () => {
  const ids = ['create-user', 'vet-datamod'];
  it('a new function fits every gap, whatever it is', () => {
    expect(dropGaps(ids, { fn: 'activate-api' })).toEqual([true, true, true]);
    expect(dropGaps(ids, { fn: 'create-user' })).toEqual([true, true, true]);
    expect(dropGaps(ids, { fn: 'member-enrol' })).toEqual([true, true, true]);
  });
  it('into an empty flow: the one gap', () => expect(dropGaps([], { fn: 'vet-datamod' })).toEqual([true]));
  it('a moved step: the gaps beside it change nothing, so they are off; every other gap is on', () => {
    const three = ['create-user', 'vet-datamod', 'activate-api'];
    expect(dropGaps(three, { from: 1 })).toEqual([true, false, false, true]);
    expect(dropGaps(three, { from: 0 })).toEqual([false, false, true, true]);
    expect(dropGaps(three, { from: 2 })).toEqual([true, true, false, false]);
  });
  it('the only step has nowhere to move', () => expect(dropGaps(['a'], { from: 0 })).toEqual([false, false]));
});

describe('titleOf', () => {
  it("a saved flow's title, trimmed", () => expect(titleOf({ title: ' New ER user ', steps: [] })).toBe('New ER user'));
  for (const def of [undefined, null, 'x', [], {}, { title: 3 }, { title: '  ' }]) it(`none in ${JSON.stringify(def)}`, () => expect(titleOf(def)).toBe(''));
});

describe('groupOf', () => {
  it("a saved flow's group, trimmed", () => expect(groupOf({ group: ' Member ', steps: [] })).toBe('Member'));
  for (const def of [undefined, null, 'x', [], {}, { group: 3 }, { group: '  ' }]) it(`none in ${JSON.stringify(def)}`, () => expect(groupOf(def)).toBe(''));
});

describe('IF items', () => {
  const saved = {
    steps: [
      { function: 'member-register' },
      { if: { value: 'status', equals: 'NEEDS_DDE' }, then: [{ function: 'vet-datamod', values: { reference_no: 'DMD1' } }], else: [{ function: 'view-permissions' }] },
      { function: 'activate-api' },
    ],
  };
  const items = () => draftFrom(FUNCTIONS, FIELDS, saved, options);

  it('a saved IF comes back as an IF item with its arms, and goes back out unchanged', () => {
    const got = items();
    expect(isDraftIf(got[1])).toBe(true);
    const ifItem = got[1] as DraftIf;
    expect(ifItem.cond).toEqual({ value: 'status', op: 'equals', to: 'NEEDS_DDE' });
    expect(ifItem.then.map((s) => s.fn)).toEqual(['vet-datamod']);
    expect(flowOf(got, FIELDS)).toEqual(saved);
  });

  it('notEquals and "is set" conditions round-trip; an empty else is left out; text is trimmed', () => {
    for (const cond of [{ value: 's', notEquals: 'X' }, { value: 's' }, { value: 's', equals: '' }]) {
      const def = { steps: [{ if: cond, then: [{ function: 'vet-datamod' }] }] };
      expect(flowOf(draftFrom(FUNCTIONS, FIELDS, def, options), FIELDS)).toEqual(def);
    }
    const item: DraftIf = { ...newIf(), cond: { value: ' s ', op: 'equals', to: ' A ' } };
    expect(flowOf([item], FIELDS)).toEqual({ steps: [{ if: { value: 's', equals: 'A' }, then: [] }] });
  });

  it('newIf: blank condition, empty arms, a key of its own', () => {
    const a = newIf();
    expect({ ...a, key: '' }).toEqual({ key: '', kind: 'if', cond: { value: '', op: 'equals', to: '' }, then: [], else: [] });
    expect(newIf().key).not.toBe(a.key);
  });

  it('flatIndexes numbers items and arm steps as the flow check does; allSteps lists function steps in that order', () => {
    const got = items();
    const at = flatIndexes(got);
    const ifItem = got[1] as DraftIf;
    expect([at.get(got[0].key), at.get(got[1].key), at.get(ifItem.then[0].key), at.get(ifItem.else[0].key), at.get(got[2].key)]).toEqual([0, 1, 2, 3, 4]);
    expect(allSteps(got).map((s) => s.fn)).toEqual(['member-register', 'vet-datamod', 'view-permissions', 'activate-api']);
  });

  it('replaceStep and removeKey reach arm steps; removing the IF drops its arms', () => {
    const got = items();
    const armStep = (got[1] as DraftIf).then[0];
    const replaced = replaceStep(got, armStep.key, { ...armStep, values: { reference_no: 'DMD2' } });
    expect((replaced[1] as DraftIf).then[0].values).toEqual({ reference_no: 'DMD2' });
    expect(replaced[0]).toBe(got[0]);
    expect((removeKey(got, armStep.key)[1] as DraftIf).then).toEqual([]);
    expect(removeKey(got, got[1].key).map((i) => (isDraftIf(i) ? 'IF' : i.fn))).toEqual(['member-register', 'activate-api']);
  });

  it('updateIf changes only the IF it names', () => {
    const got = items();
    const next = updateIf(got, got[1].key, (it) => ({ ...it, cond: { ...it.cond, to: 'X' } }));
    expect((next[1] as DraftIf).cond.to).toBe('X');
    expect(updateIf(got, got[0].key, (it) => ({ ...it, then: [] }))).toEqual(got);
  });

  it('testableBefore: what earlier steps are sure to give', () => {
    const flow = flowOf(items(), FIELDS);
    expect(testableBefore(FUNCTIONS, flow, 1)).toEqual(['registration_no', 'mobile']);
    expect(testableBefore(FUNCTIONS, flow, 0)).toEqual([]);
  });

  it('an arm step\'s placeholder names the step before the IF that gives it', () => {
    const flow = flowOf(items(), FIELDS);
    expect(placeholderFor(FUNCTIONS, flow, 3, fieldOf('mobile'), true)).toBe('from step 1');
  });

  it('dropGaps: a dragged IF from the palette may drop in any gap', () => expect(dropGaps(['a', 'b'], { if: true })).toEqual([true, true, true]));
});
