import type { FieldJson, Fn, HistoryItem, Meta, RecordRow } from '../api.ts';
import { ACCOUNTS_FORM, MEMBER_FORM, USER_FORM } from '../../../test/fixtures/forms.ts';

export const fn = (id: string, over: Partial<Fn> = {}): Fn => ({ id, title: id, detail: '', starts: false, inputs: {}, outputs: [], env: [], setup: [], file: `${id}.fn.ts`, ...over });

export const FUNCTIONS: Fn[] = [
  fn('create-user', { title: '[Web] Create ER User', record: 'er-user', recordKey: 'reference_no', starts: true, inputs: { user_spec: 'required' }, outputs: ['reference_no', 'mobile', 'company'] }),
  fn('vet-datamod', { title: '[Admin] Vet', record: 'er-user', recordKey: 'reference_no', inputs: { reference_no: 'required' }, outputs: ['reference_no', 'status'] }),
  fn('activate-api', {
    title: '[API] Activate',
    record: 'er-user',
    recordKey: 'reference_no',
    inputs: { reference_no: 'required', mobile: 'required', username: 'optional', password: 'optional' },
    outputs: ['reference_no', 'status', 'username', 'password'],
  }),
  fn('member-register', { title: '[Web] Register', record: 'member', recordKey: 'registration_no', starts: true, inputs: { member_spec: 'optional' }, outputs: ['registration_no', 'mobile'] }),
  fn('member-enrol', {
    title: '[Web] Enrol',
    record: 'member',
    recordKey: 'registration_no',
    inputs: { registration_no: 'required', mobile: 'required', account_type: 'required', scheme: 'required' },
    outputs: ['enrolment_no', 'status'],
  }),
  fn('view-permissions', { title: '[Web] View Permissions', inputs: { accounts: 'required', view_as: 'optional' } }),
];

export const FIELDS: FieldJson[] = [
  { name: 'user_spec', kind: 'json', label: 'User spec', form: USER_FORM, presets: 'users' },
  { name: 'member_spec', kind: 'json', label: 'Member spec', form: MEMBER_FORM, presets: 'members' },
  { name: 'accounts', kind: 'json', label: 'Accounts', form: ACCOUNTS_FORM, presets: 'accounts' },
  { name: 'view_as', kind: 'text', label: 'View as' },
  { name: 'reference_no', kind: 'text', label: 'DataMod ref', pattern: '^DMD\\d+$', placeholder: 'DMD…' },
  { name: 'registration_no', kind: 'text', label: 'Registration ref', placeholder: 'RGD…' },
  { name: 'enrolment_no', kind: 'text', label: 'Enrolment ref' },
  { name: 'company', kind: 'text', label: 'Company' },
  { name: 'mobile', kind: 'text', label: 'Mobile', placeholder: '8 digits' },
  { name: 'username', kind: 'text', label: 'Username', placeholder: 'etoe.<stamp>' },
  { name: 'password', kind: 'secret', label: 'Password' },
  { name: 'account_type', kind: 'select', label: 'Account type', options: ['PA'], labels: { PA: 'PA: Personal Account' } },
  { name: 'scheme', kind: 'text', label: 'Scheme' },
  { name: 'status', kind: 'text', label: 'Status' },
];

export const META: Meta = {
  functions: FUNCTIONS,
  fields: FIELDS,
  settings: {
    title: 'Test flows',
    records: { 'er-user': { key: 'reference_no', label: 'ER user', summary: [] }, member: { key: 'registration_no', label: 'member', summary: [] } },
    command: 'npm run fn --',
    unsetEnv: [],
    failures: [],
  },
  options: {
    creators: [{ value: 'ER', label: 'ER' }],
    userTypes: [{ value: 'Company AP', label: 'Company AP' }],
    scheme: [{ value: 'BCT (MPF) Pro Choice', label: 'BCT (MPF) Pro Choice' }],
    'er-user': [{ value: 'DMD1', label: 'DMD1 Company AP @ Acme' }],
  },
};

export const run = (over: Partial<HistoryItem> = {}): HistoryItem =>
  ({
    id: '20261105-120000-aaaa',
    project: 'member-register',
    title: '[Web] Register',
    startedAt: 0,
    endedAt: 65_000,
    status: 'passed',
    input: { member_spec: '{}' },
    headed: false,
    records: [{ kind: 'member', ref: 'RGD1', stage: 'member-register', stageLabel: 'Register · ACTIVATED', summary: 'RGD1 Member 1 etoe.x' }],
    summary: 'username etoe.{stamp}',
    hasReport: true,
    live: false,
    view: { failures: [] },
    ...over,
  }) as HistoryItem;

export const record = (over: Partial<RecordRow> = {}): RecordRow => ({
  kind: 'er-user',
  key: 'DMD1',
  stage: 'create-user',
  stageLabel: 'Create · SUBMITTED',
  summary: 'DMD1 Company AP @ Acme · Create · SUBMITTED',
  updatedAt: '2026-11-05T00:00:00Z',
  values: { reference_no: 'DMD1', mobile: '91234567' },
  details: [
    ['Username', 'etoe.abc'],
    ['Password', 'pw'],
  ],
  history: ['create-user'],
  functions: [{ id: 'vet-datamod', title: '[Admin] Vet' }],
  ...over,
});
