import type { ReactNode } from 'react';
import type { Group } from '../lib/groups.ts';

/** Props of {@link Grouped}. */
export type GroupedProps<T> = {
  /** From `groupItems`. A single group labelled `''` renders as one list with no heading. */
  groups: Group<T>[];
  /** Class of the element holding each group's items, e.g. `cards` or `fnlist`. */
  listClass: string;
  /** Renders one item; must return an element with a `key`. */
  render: (item: T) => ReactNode;
  /** Appended to the last group's list, e.g. a "+ New" card. With no groups it shows alone in one list. */
  after?: ReactNode;
};

/** Items in a list per group, each under an `h3` and in a region named after the group. */
export const Grouped = <T,>({ groups, listClass, render, after }: GroupedProps<T>) => {
  if (!groups.length) return <div className={listClass}>{after}</div>;
  if (groups.length === 1 && !groups[0].label)
    return (
      <div className={listClass}>
        {groups[0].items.map(render)}
        {after}
      </div>
    );
  return (
    <>
      {groups.map((group, i) => (
        <div key={group.label} className="group" role="region" aria-label={group.label}>
          <h3 className="group-head">{group.label}</h3>
          <div className={listClass}>
            {group.items.map(render)}
            {i === groups.length - 1 && after}
          </div>
        </div>
      ))}
    </>
  );
};
