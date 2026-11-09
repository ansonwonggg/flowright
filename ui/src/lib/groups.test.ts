import { describe, expect, it } from 'vitest';
import { groupItems, OTHER } from './groups.ts';

type Item = { id: string; group?: string };
const items = (...pairs: [string, string?][]): Item[] => pairs.map(([id, group]) => ({ id, ...(group !== undefined && { group }) }));
const shape = (list: Item[]) => groupItems(list, (i) => i.group).map((g) => [g.label, g.items.map((i) => i.id)]);

describe('groupItems', () => {
  it('groups in the order each first appears, items keeping their order', () =>
    expect(shape(items(['a', 'Web'], ['b', 'Admin'], ['c', 'Web']))).toEqual([
      ['Web', ['a', 'c']],
      ['Admin', ['b']],
    ]));
  it(`items without a group go last, under "${OTHER}"`, () =>
    expect(shape(items(['a'], ['b', 'Web'], ['c']))).toEqual([
      ['Web', ['b']],
      [OTHER, ['a', 'c']],
    ]));
  it('a blank group counts as none; names are trimmed', () =>
    expect(shape(items(['a', '  '], ['b', ' Web '], ['c', 'Web']))).toEqual([
      ['Web', ['b', 'c']],
      [OTHER, ['a']],
    ]));
  it('names differing only in case are separate groups', () => expect(shape(items(['a', 'Web'], ['b', 'web'])).map(([l]) => l)).toEqual(['Web', 'web']));
  it('nothing grouped: one group with a blank label, so the list shows flat', () => expect(shape(items(['a'], ['b', '']))).toEqual([['', ['a', 'b']]]));
  it('one item with one group: that group alone', () => expect(shape(items(['a', 'Web']))).toEqual([['Web', ['a']]]));
  it('no items: no groups', () => expect(shape([])).toEqual([]));
});
