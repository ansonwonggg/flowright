import { defineFunction } from '../kit.ts';
import { DEFAULT_PASSWORD, stamp } from '../portal/test.ts';
import { activateMember, registerMember } from './steps/register.step.ts';

export default defineFunction({
  id: 'register-member',
  title: '[Web] Member Registration with Activation',
  detail: 'register, then activate on the same page',
  record: 'member',
  starts: true,
  inputs: { mobile: 'optional', username: 'optional', password: 'optional' },
  outputs: ['registration_no', 'member_id', 'status', 'mobile', 'username', 'password'],
  run: async ({ page }, input) => {
    const registered = await registerMember({ page }, input);
    const login = { username: input.username ?? `etoe.${stamp()}`, password: input.password ?? DEFAULT_PASSWORD };
    await activateMember({ page }, login);
    return { registration_no: registered.ref, member_id: registered.member_id, mobile: registered.mobile, status: 'ACTIVATED', ...login };
  },
});
