import { test } from '@playwright/test';
import { createKit, defineFields, field } from '../src/index.ts';

const { defineFunction } = createKit(
  defineFields({ ref: field.text({ label: 'Ref' }), mobile: field.text({ label: 'Mobile' }), status: field.text({ label: 'Status' }), spec: field.json<{ company: string }>({ label: 'Spec' }) }),
  { test, records: { user: 'ref' } },
);

defineFunction({
  id: 'json',
  title: 'json',
  record: 'user',
  inputs: { spec: 'required' },
  outputs: ['spec'],
  run: async (_, input) => {
    const company: string = input.spec.company;
    // @ts-expect-error a JSON field has its declared type, not string
    const text: string = input.spec;
    void text;
    return { spec: { company } };
  },
});

defineFunction({
  id: 'bad-record',
  title: 'r',
  // @ts-expect-error a record kind must be declared in the kit
  record: 'member',
  inputs: {},
  outputs: [],
  run: async () => ({}),
});

createKit(defineFields({ ref: field.text({ label: 'Ref' }) }), {
  test,
  // @ts-expect-error a record key must be a registry name
  records: { user: 'reference' },
});

defineFunction({
  id: 'ok',
  title: 'ok',
  inputs: { ref: 'required', mobile: 'optional' },
  outputs: ['status'],
  run: async ({ page }, input) => {
    const ref: string = input.ref;
    // @ts-expect-error an optional input may be undefined
    const mobile: string = input.mobile;
    void page;
    void mobile;
    return { status: ref };
  },
});

defineFunction({
  id: 'typo-input',
  title: 't',
  // @ts-expect-error an input name must be in the registry
  inputs: { refernce: 'required' },
  outputs: [],
  run: async () => ({}),
});

defineFunction({
  id: 'typo-output',
  title: 't',
  inputs: {},
  // @ts-expect-error an output name must be in the registry
  outputs: ['stats'],
  run: async () => ({}),
});

defineFunction({
  id: 'undeclared-output',
  title: 't',
  inputs: {},
  outputs: ['status'],
  // @ts-expect-error run may return only declared outputs
  run: async () => ({ mobile: 'x' }),
});

defineFunction({
  id: 'bad-need',
  title: 't',
  // @ts-expect-error a need is required or optional
  inputs: { ref: 'maybe' },
  outputs: [],
  run: async () => ({}),
});
