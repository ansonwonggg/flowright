/** The heading for items without a group, when other items have one. */
export const OTHER = 'Other';

/** A labelled run of items. A blank `label` means nothing was grouped: show the items without a heading. */
export type Group<T> = { label: string; items: T[] };

/**
 * Items split by `groupOf`: groups in the order each is first met, items keeping their order, and items
 * without a group last under {@link OTHER}. Names are trimmed and blank counts as none; case matters.
 * When no item has a group, gives one group labelled `''`; no items gives `[]`.
 */
export const groupItems = <T,>(items: T[], groupOf: (item: T) => string | undefined): Group<T>[] => {
  const byLabel = new Map<string, T[]>();
  for (const item of items) {
    const label = groupOf(item)?.trim() || '';
    byLabel.set(label, [...(byLabel.get(label) ?? []), item]);
  }
  const ungrouped = byLabel.get('') ?? [];
  byLabel.delete('');
  if (!byLabel.size) return items.length ? [{ label: '', items: ungrouped }] : [];
  const groups = [...byLabel].map(([label, list]) => ({ label, items: list }));
  return ungrouped.length ? [...groups, { label: OTHER, items: ungrouped }] : groups;
};
