import { createKit, defineFields, field } from '../src/index.ts';
import { test } from './portal/test.ts';
import { USER_SPEC_FORM, validateUserSpec, type UserSpec } from './userSpec.ts';

export const fields = defineFields({
  user_spec: field.json<UserSpec>({ label: 'User spec', validate: validateUserSpec, form: USER_SPEC_FORM, presets: 'users', describe: (v) => `${v?.user_type ?? '?'} for ${v?.company ?? '?'}` }),
  reference_no: field.text({ label: 'DataMod ref', pattern: /^DMD\d{16}$/, placeholder: 'DMD…' }),
  registration_no: field.text({ label: 'Registration ref', pattern: /^RGD\d{16}$/, placeholder: 'RGD…' }),
  member_id: field.text({ label: 'Member ID', pattern: /^\d{11}$/ }),
  id_type: field.select({ label: 'ID type', options: ['HKID'] }),
  id_number: field.text({ label: 'ID number', pattern: /^[A-Z]{1,2}\d{6}\([0-9A]\)$/, placeholder: 'A123456(7)' }),
  mobile: field.text({ label: 'Mobile', pattern: /^\d{8}$/, placeholder: '8 digits' }),
  first_name: field.text({ label: 'First name (English)' }),
  last_name: field.text({ label: 'Last name (English)' }),
  date_of_birth: field.text({ label: 'Date of birth', pattern: /^\d{2}\/\d{2}\/\d{4}$/, placeholder: 'DD/MM/YYYY' }),
  username: field.text({ label: 'Username', pattern: /^[A-Za-z0-9_.]{8,50}$/, placeholder: 'etoe.<stamp>' }),
  password: field.secret({ label: 'Password', placeholder: 'the default test password' }),
  status: field.text({ label: 'Status' }),
});

export const { defineFunction, defineStep, records } = createKit(fields, {
  test,
  title: 'Example flows',
  records: {
    'er-user': { key: 'reference_no', label: 'ER user', summary: ['{username}'] },
    member: { key: 'registration_no', label: 'member', summary: ['Member {member_id}'] },
  },
  command: 'node src/cli.ts run example',
  failures: [{ kind: 'portal', match: 'is not in your company list', title: 'The portal refused the company', hint: 'Use a company from the fake portal list.' }],
});
