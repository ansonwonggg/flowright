import { expect, type Page } from '@playwright/test';
import { defineStep } from '../../kit.ts';

export const verifyIdentity = defineStep<{ page: Page }, { id_number: string; mobile: string }>({
  name: 'ID number + mobile, send OTP',
  portal: 'web',
  run: async ({ page }, { id_number, mobile }) => {
    await page.goto('/web/activate');
    await page.getByLabel('ID No.').fill(id_number);
    await page.getByLabel('Mobile').fill(mobile);
    await page.getByRole('button', { name: 'Send OTP' }).click();
    await expect(page.getByRole('heading', { name: 'Create username and password' })).toBeVisible();
  },
});

export const setLogin = defineStep<{ page: Page }, { username: string; password: string }>({
  name: 'Set username and password, activate',
  portal: 'web',
  screenshot: 'activate-done',
  run: async ({ page }, { username, password }) => {
    await expect(page.getByRole('heading', { name: 'Session expired' })).toBeHidden();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByRole('heading', { name: 'Account activated' })).toBeVisible();
  },
});
