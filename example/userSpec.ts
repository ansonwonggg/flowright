import type { FormConfig } from '../src/forms/types.ts';

export const USER_TYPES = ['Company AP', 'Scheme AP', 'Other User'] as const;

/** What to create: the company, the user type, and for an Other User, the rights to tick. */
export type UserSpec = {
  company: string;
  user_type: (typeof USER_TYPES)[number];
  rights?: { function: string; role: 'Preparer' | 'Approver' }[];
};

/** Every problem with a user spec, one message each; empty when it is valid. */
export const validateUserSpec = (value: unknown): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['must be an object'];
  const spec = value as Partial<UserSpec>;
  const problems: string[] = [];
  if (typeof spec.company !== 'string' || !spec.company.trim()) problems.push('company is required');
  if (!USER_TYPES.includes(spec.user_type as UserSpec['user_type'])) problems.push(`user_type must be one of ${USER_TYPES.join(', ')}`);
  if (spec.rights !== undefined) {
    if (!Array.isArray(spec.rights)) problems.push('rights must be a list');
    else if (spec.user_type !== 'Other User') problems.push('only an Other User has rights');
    else spec.rights.forEach((r, i) => !r?.function && problems.push(`right ${i + 1} needs a function`));
  }
  return problems;
};

/** How an app should draw a user spec. flowkit passes it on untouched. */
const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

export const USER_SPEC_FORM: FormConfig = {
  blank: { company: '', user_type: 'Company AP' },
  fields: [
    { key: 'company', type: 'text', label: 'Company' },
    { key: 'user_type', type: 'radio', label: 'User type', options: asOptions(USER_TYPES) },
    {
      key: 'rights',
      type: 'list',
      label: 'Rights',
      showWhen: { user_type: ['Other User'] },
      newItem: { function: '', role: 'Preparer' },
      addLabel: 'Add a right',
      itemLabel: 'Right',
      item: [
        { key: 'function', type: 'text', label: 'Function' },
        { key: 'role', type: 'select', label: 'Role', options: asOptions(['Preparer', 'Approver']) },
      ],
    },
  ],
};
