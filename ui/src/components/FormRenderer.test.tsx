import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { toSpec, type FormValues } from '../../../src/forms/engine.ts';
import { ACCOUNTS_FORM, MEMBER_FORM, USER_FORM } from '../../../test/fixtures/forms.ts';
import type { FormConfig } from '../../../src/forms/types.ts';
import { FormRenderer } from './FormRenderer.tsx';

const options = {
  creators: [
    { value: 'ER', label: 'ER' },
    { value: 'MASTER_GOV', label: 'MASTER_GOV' },
  ],
  userTypes: ['Company AP', 'Scheme AP', 'Other User'].map((v) => ({ value: v, label: v })),
  controls: [
    { value: 'company', label: 'Company Control' },
    { value: 'payrollGroup', label: 'Payroll Group Control' },
  ],
  roles: ['Preparer', 'Approver', 'Select All'].map((v) => ({ value: v, label: v })),
  accountTypes: [{ value: 'PA', label: 'Personal Account (PA)' }],
  'er-user': [{ value: 'DMD1', label: 'DMD1 Company AP @ Acme' }],
  company: [{ value: 'Acme', label: 'Acme' }],
};

const Harness = ({ form, initial, project = 'create-user', spy }: { form: FormConfig; initial: FormValues; project?: string; spy?: (v: FormValues) => void }) => {
  const [values, setValues] = useState(initial);
  return (
    <>
      <FormRenderer
        form={form}
        values={values}
        options={options}
        project={project}
        onChange={(v) => {
          setValues(v);
          spy?.(v);
        }}
      />
      <output data-testid="spec">{JSON.stringify(toSpec(form, values, project))}</output>
    </>
  );
};

const spec = () => JSON.parse(screen.getByTestId('spec').textContent ?? '{}');

describe('FormRenderer: user form', () => {
  const base = { creator: 'ER', company: 'Acme', userType: 'Company AP' };

  it('renders labelled fields with their values', () => {
    render(<Harness form={USER_FORM} initial={base} />);
    expect(screen.getByLabelText('Creator account')).toHaveValue('ER');
    expect(screen.getByLabelText('Company')).toHaveValue('Acme');
    expect(screen.getByRole('radio', { name: 'Company AP' })).toBeChecked();
    expect(screen.getByText('Must match the company list exactly.')).toBeInTheDocument();
  });

  it('shows the scheme account only for a Scheme AP', async () => {
    render(<Harness form={USER_FORM} initial={base} />);
    expect(screen.queryByLabelText('Scheme account')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Scheme AP' }));
    expect(screen.getByLabelText('Scheme account')).toBeInTheDocument();
  });

  it('Other User starts with one rights row; adding, editing and removing rows updates the spec', async () => {
    render(<Harness form={USER_FORM} initial={base} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Other User' }));
    expect(screen.getByLabelText('Right 1 path')).toHaveAttribute('placeholder', 'function, e.g. Company User Management');
    expect(spec().rights).toBeUndefined();

    await userEvent.type(screen.getByLabelText('Right 1 path'), 'Company User Management');
    await userEvent.click(screen.getByRole('button', { name: '+ Add right' }));
    await userEvent.selectOptions(screen.getByLabelText('Right 2 control'), 'payrollGroup');
    await userEvent.type(screen.getByLabelText('Right 2 path'), 'BCT > 03 > Contribution');
    await userEvent.selectOptions(screen.getByLabelText('Right 2 role'), 'Approver');
    expect(spec().rights).toEqual([
      { control: 'company', path: ['Company User Management'], role: 'Preparer' },
      { control: 'payrollGroup', path: ['BCT', '03', 'Contribution'], role: 'Approver' },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove right 1' }));
    expect(screen.queryByLabelText('Right 2 path')).not.toBeInTheDocument();
    expect(spec().rights).toEqual([{ control: 'payrollGroup', path: ['BCT', '03', 'Contribution'], role: 'Approver' }]);
  });

  it('keeps the typed path text while typing a separator', async () => {
    render(<Harness form={USER_FORM} initial={{ ...base, userType: 'Other User' }} />);
    await userEvent.type(screen.getByLabelText('Right 1 path'), 'BCT >');
    expect(screen.getByLabelText('Right 1 path')).toHaveValue('BCT >');
  });

  it('a value not in its option list still shows', () => {
    render(<Harness form={USER_FORM} initial={{ ...base, creator: 'OLD_CREATOR' }} />);
    expect(screen.getByLabelText('Creator account')).toHaveValue('OLD_CREATOR');
  });

  it('the checkbox sets true and clearing it drops the field', async () => {
    render(<Harness form={USER_FORM} initial={base} />);
    const box = screen.getByRole('checkbox', { name: /Give the user an email/ });
    await userEvent.click(box);
    expect(spec().email).toBe(true);
    await userEvent.click(box);
    expect(spec().email).toBeUndefined();
  });

  it('offers suggestions on text fields', () => {
    const { container } = render(<Harness form={USER_FORM} initial={base} />);
    expect(screen.getByLabelText('Company')).toHaveAttribute('list', 's-company');
    expect(container.querySelector('datalist#s-company option')).toHaveAttribute('value', 'Acme');
  });
});

describe('FormRenderer: member form', () => {
  it('has username and email but no enrolment, and leaves an old enrolment out of the spec', () => {
    render(<Harness form={MEMBER_FORM} initial={{ enrolment: { accountType: 'PA', scheme: 'BCT' } }} project="member-register" />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByLabelText('Scheme')).not.toBeInTheDocument();
    expect(spec()).toEqual({});
  });

  it('a missing nested value renders empty', () => {
    const nested: FormConfig = { blank: {}, fields: [{ key: 'a.b', type: 'text', label: 'Nested' }] };
    render(<Harness form={nested} initial={{}} project="member-register" />);
    expect(screen.getByLabelText('Nested')).toHaveValue('');
  });
});

describe('FormRenderer: accounts form', () => {
  it('rows of ID and user become the spec; removing a row drops it', async () => {
    const spy = vi.fn();
    render(<Harness form={ACCOUNTS_FORM} initial={{ '': [] }} project="view-permissions" spy={spy} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add account' }));
    await userEvent.type(screen.getByLabelText('Account 1 ID'), 'G1');
    await userEvent.selectOptions(screen.getByLabelText('Account 1 user'), 'DMD1');
    expect(spec()).toEqual({ G1: 'DMD1' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove account 1' }));
    expect(spec()).toEqual({});
    expect(spy).toHaveBeenCalled();
  });

  it('the user select starts on "Pick…"', async () => {
    render(<Harness form={ACCOUNTS_FORM} initial={{ '': [{ key: 'G1', value: '' }] }} project="view-permissions" />);
    expect(screen.getByLabelText('Account 1 user')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Pick…' })).toBeInTheDocument();
  });
});
