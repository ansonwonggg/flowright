import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier) && context.parentURL?.startsWith('file:')) {
      for (const suffix of ['.ts', '/index.ts']) {
        const candidate = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
