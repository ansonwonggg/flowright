import { defineFunction } from '../kit.ts';
import { DEFAULT_PASSWORD, stamp } from '../portal/test.ts';
import { activateOnKiosk } from './steps/activateKiosk.step.ts';

export default defineFunction({
  id: 'activate-er-user-kiosk',
  title: '[Kiosk] Activate ER User Account',
  detail: 'kiosk screen: needs a 1920×1080 viewport',
  record: 'er-user',
  use: { viewport: { width: 1920, height: 1080 } },
  inputs: { reference_no: 'required', id_number: 'required', mobile: 'required', username: 'optional', password: 'optional' },
  outputs: ['reference_no', 'status', 'username', 'password'],
  run: async ({ page }, input) => {
    const login = { username: input.username ?? `etoe.${stamp()}`, password: input.password ?? DEFAULT_PASSWORD };
    await activateOnKiosk({ page }, { ...input, ...login });
    return { reference_no: input.reference_no, status: 'ACTIVATED', ...login };
  },
});
