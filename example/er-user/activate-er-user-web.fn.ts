import { defineFunction } from '../kit.ts';
import { DEFAULT_PASSWORD, stamp } from '../portal/test.ts';
import { setLogin, verifyIdentity } from './steps/activateWeb.step.ts';

export default defineFunction({
  id: 'activate-er-user-web',
  title: '[Web] Activate ER User Account',
  detail: 'two steps on one page: the session lives in sessionStorage',
  record: 'er-user',
  inputs: { reference_no: 'required', id_number: 'required', mobile: 'required', username: 'optional', password: 'optional' },
  outputs: ['reference_no', 'status', 'username', 'password'],
  run: async ({ page }, input) => {
    const login = { username: input.username ?? `etoe.${stamp()}`, password: input.password ?? DEFAULT_PASSWORD };
    await verifyIdentity({ page }, input);
    await setLogin({ page }, login);
    return { reference_no: input.reference_no, status: 'ACTIVATED', ...login };
  },
});
