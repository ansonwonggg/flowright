import { defineFunction } from '../kit.ts';
import { ADMIN_STATE } from '../portal/fake-portal.ts';
import { markAllValid, waitForSucceed } from './steps/vet.step.ts';

export default defineFunction({
  id: 'vet-er-user',
  title: '[Admin] Document Vetting on new ER User',
  detail: 'vet the case in the admin portal until SUCCEED',
  record: 'er-user',
  setup: ['admin-login'],
  use: { storageState: ADMIN_STATE },
  timeout: 120_000,
  inputs: { reference_no: 'required' },
  outputs: ['reference_no', 'status'],
  run: async ({ page }, { reference_no }) => {
    await markAllValid({ page }, { ref: reference_no });
    return { reference_no, status: await waitForSucceed({ page }) };
  },
});
