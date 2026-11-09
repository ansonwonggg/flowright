import { expect, type Page } from '@playwright/test';
import { defineStep } from '../../kit.ts';

export const markAllValid = defineStep<{ page: Page }, { ref: string }>({
  name: 'Open the case and mark every document VALID',
  portal: 'admin',
  run: async ({ page }, { ref }) => {
    await page.goto(`/admin/vet?ref=${ref}`);
    await expect(page.locator('#case-status')).toHaveText('SUBMITTED');
    await page.getByRole('button', { name: 'Mark all VALID' }).click();
    await expect(page.getByRole('alert')).toBeEmpty();
  },
});

export const waitForSucceed = defineStep<{ page: Page }, void, string>({
  name: 'Wait for the case to reach SUCCEED',
  portal: 'admin',
  screenshot: 'vet-succeed',
  run: async ({ page }) => {
    await expect(page.locator('#case-status')).toHaveText('SUCCEED', { timeout: 30_000 });
    return 'SUCCEED';
  },
});
