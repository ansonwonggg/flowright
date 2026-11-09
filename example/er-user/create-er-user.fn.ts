import { defineFunction } from '../kit.ts';
import { submitNewUser } from './steps/createUser.step.ts';

export default defineFunction({
  id: 'create-er-user',
  title: '[Web] Create ER User',
  detail: 'create the user as a master account and submit it for vetting',
  record: 'er-user',
  starts: true,
  inputs: { user_spec: 'required' },
  outputs: ['reference_no', 'id_type', 'id_number', 'mobile', 'first_name', 'last_name', 'date_of_birth'],
  run: async ({ page }, input) => {
    const { ref, person } = await submitNewUser({ page }, input.user_spec);
    return { reference_no: ref, id_type: 'HKID', ...person };
  },
});
