import { mkdirSync } from 'node:fs';
import { expect } from '@playwright/test';
import { ADMIN_STATE, DATA_DIR } from '../portal/fake-portal.ts';
import { test } from '../portal/test.ts';

test('log in to the admin portal and keep the session', async ({ page, context }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill(process.env.FAKE_ADMIN_PASSWORD ?? 'demo');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/admin\/home$/);
  mkdirSync(DATA_DIR, { recursive: true });
  await context.storageState({ path: ADMIN_STATE });
});
