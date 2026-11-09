import { expect, type Page } from '@playwright/test';
import { defineStep } from '../../kit.ts';

export const activateOnKiosk = defineStep<{ page: Page }, { id_number: string; mobile: string; username: string; password: string }>({
  name: 'Activate on the kiosk screen',
  portal: 'kiosk',
  screenshot: 'kiosk-done',
  run: async ({ page }, input) => {
    await page.goto('/kiosk/activate');
    await expect(page.getByRole('heading', { name: 'Screen too small for the kiosk' })).toBeHidden();
    await page.getByLabel('ID No.').fill(input.id_number);
    await page.getByLabel('Mobile').fill(input.mobile);
    await page.getByLabel('Username').fill(input.username);
    await page.getByLabel('Password').fill(input.password);
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByRole('heading', { name: 'Account activated' })).toBeVisible();
  },
});
