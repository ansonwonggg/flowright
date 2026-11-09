import type { FormConfig, FormField } from '../../src/forms/types.ts';

/** Sample forms for the tests: the shapes a real repo uses (select from a list, radio, list rows, entries). */

const userFields: FormField[] = [
  {
    key: 'creator',
    type: 'select',
    label: 'Creator account',
    options: 'creators',
    hint: 'The ER login that creates the user: <NAME>_USER / _PASSWORD in .env.local.',
  },
  { key: 'company', type: 'text', label: 'Company', suggest: 'company', placeholder: 'Exact English or Chinese name', hint: 'Must match the company list exactly.' },
  { key: 'userType', type: 'radio', label: 'User type', options: 'userTypes' },
  {
    key: 'schemeAccount',
    type: 'text',
    label: 'Scheme account',
    suggest: 'schemeAccounts',
    placeholder: 'BCT (MPF) Industry Choice | Account No.: 10054446',
    hint: 'The start of its option on "Select Scheme & Account".',
    showWhen: { userType: ['Scheme AP'] },
  },
  { key: 'email', type: 'checkbox', label: 'Give the user an email (stays unverified)' },
  {
    key: 'rights',
    type: 'list',
    label: 'Rights',
    itemLabel: 'Right',
    addLabel: '+ Add right',
    newItem: { control: 'company', path: [], role: 'Preparer' },
    minRows: 1,
    showWhen: { userType: ['Other User'] },
    hint: 'Path walks the table from the top row down, separated by >. Use Select All for a whole scheme or group row.',
    item: [
      { key: 'control', type: 'select', label: 'control', options: 'controls' },
      {
        key: 'path',
        type: 'path',
        label: 'path',
        placeholderBy: {
          key: 'control',
          values: { company: 'function, e.g. Company User Management', scheme: 'scheme, or scheme > function', payrollGroup: 'scheme > group > function' },
        },
      },
      { key: 'role', type: 'select', label: 'role', options: 'roles' },
    ],
  },
];

const memberFields: FormField[] = [
  {
    key: 'username',
    type: 'text',
    label: 'Username',
    placeholder: 'etoe.{stamp}',
    hint: '{stamp} becomes a unique stamp, so the preset can run many times. Without it the name works once. Empty means etoe.{stamp}.',
  },
  { key: 'email', type: 'checkbox', label: 'Give the member an email from iAM Smart (otherwise mobile only)' },
];

export const USER_FORM: FormConfig = {
  blank: { creator: '', company: '', userType: 'Company AP' },
  fields: userFields,
};

export const MEMBER_FORM: FormConfig = {
  blank: {},
  fields: memberFields,
};

export const ACCOUNTS_FORM: FormConfig = {
  blank: {},
  fields: [
    {
      key: '',
      type: 'entries',
      label: 'Accounts',
      itemLabel: 'Account',
      addLabel: '+ Add account',
      keyField: { key: 'key', type: 'text', label: 'ID', placeholder: 'ID, e.g. G1' },
      valueField: { key: 'value', type: 'select', label: 'user', options: 'er-user' },
    },
  ],
};
