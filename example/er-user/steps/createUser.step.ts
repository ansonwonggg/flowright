import { expect, type Page } from '@playwright/test';
import { defineStep } from '../../kit.ts';
import type { UserSpec } from '../../userSpec.ts';

type Person = { id_number: string; mobile: string; first_name: string; last_name: string; date_of_birth: string };

export const submitNewUser = defineStep<{ page: Page }, UserSpec, { ref: string; person: Person }>({
  name: 'Fill in the new user and submit',
  portal: 'web',
  screenshot: 'create-submitted',
  run: async ({ page }, { company, user_type }) => {
    await page.goto('/web/create');
    await page.getByLabel('Company', { exact: true }).fill(company);
    await page.getByLabel('User type', { exact: true }).selectOption(user_type);
    const created = page.waitForResponse((r) => r.url().endsWith('/api/users') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit' }).click();
    const response = await created;
    const body = await response.json();
    expect(response.ok(), body.error).toBe(true);
    await expect(page.getByText(`Reference No.: ${body.ref}`)).toBeVisible();
    return { ref: body.ref, person: body.person };
  },
});
