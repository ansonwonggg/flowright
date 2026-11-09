import { expect, type Page } from '@playwright/test';
import { defineStep } from '../../kit.ts';

type Registered = { ref: string; member_id: string; mobile: string };

export const registerMember = defineStep<{ page: Page }, { mobile?: string }, Registered>({
  name: 'Register a member',
  portal: 'web',
  run: async ({ page }, { mobile }) => {
    await page.goto('/web/register');
    if (mobile) await page.getByLabel('Mobile').fill(mobile);
    const registered = page.waitForResponse((r) => r.url().endsWith('/api/members'));
    await page.getByRole('button', { name: 'Register' }).click();
    const body = await (await registered).json();
    await expect(page.getByText(`Registration No.: ${body.ref}`)).toBeVisible();
    return { ref: body.ref, member_id: body.member_id, mobile: body.person.mobile };
  },
});

export const activateMember = defineStep<{ page: Page }, { username: string; password: string }>({
  name: 'Activate now: set username and password',
  portal: 'web',
  screenshot: 'member-activated',
  run: async ({ page }, { username, password }) => {
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Activate now' }).click();
    await expect(page.getByRole('heading', { name: 'Member activated' })).toBeVisible();
  },
});
