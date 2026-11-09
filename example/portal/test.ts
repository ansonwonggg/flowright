import { test as base } from '@playwright/test';
import { installPortal } from './fake-portal.ts';

export const test = base.extend<{ portal: void }>({
  portal: [
    async ({ context }, use) => {
      await installPortal(context);
      await use();
    },
    { auto: true },
  ],
});

export const DEFAULT_PASSWORD = 'Demo12345!!';
export const stamp = () => Date.now().toString(36);
