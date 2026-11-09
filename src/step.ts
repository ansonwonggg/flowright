import type { Page, TestType } from '@playwright/test';

/** What every step gets first: the fixtures it works with, e.g. `{ page }` or `{ request, token }`. */
export type StepContext = object;

/**
 * A step failure, named by portal and step: `[web] Verify identity: …`. The original error is `cause`.
 * A failure inside a nested step keeps the innermost name.
 */
export class StepError extends Error {
  readonly portal: string;
  readonly step: string;
  constructor(portal: string, step: string, cause: unknown) {
    super(`[${portal}] ${step}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'StepError';
    this.portal = portal;
    this.step = step;
  }
}

const STEP = Symbol.for('flowkit.step');

/** What a step file exports: a function to call from a function's `run`, carrying its name and portal. */
export type Step<C extends StepContext, I, O> = ((ctx: C, input: I) => Promise<O>) & { readonly [STEP]: { name: string; portal: string } };

/** The `defineStep` a kit gives out, bound to the repo's own Playwright `test`. */
export type DefineStep = <C extends StepContext, I = void, O = void>(def: { name: string; portal: string; screenshot?: string; run: (ctx: C, input: I) => Promise<O> }) => Step<C, I, O>;

/**
 * Makes `defineStep` for one repo's Playwright `test`. flowkit imports nothing from Playwright at run time,
 * so a repo that links it never loads two copies.
 *
 * `defineStep` declares one action on one portal, e.g. "HKID + mobile, send and enter OTP":
 * - it runs as a boxed `test.step` named `[portal] name`, so reports and the app show it by name;
 * - with `screenshot`, it attaches a screenshot of `ctx.page`, when there is one, under that name when the step passes;
 * - any error is rethrown as a {@link StepError} naming the portal and step.
 *
 * Call a step only inside a running test (a function's `run`).
 */
export const stepMaker = (test: TestType<any, any>): DefineStep => (def) => {
  const run = (ctx: Parameters<typeof def.run>[0], input: Parameters<typeof def.run>[1]) =>
    test.step(
      `[${def.portal}] ${def.name}`,
      async () => {
        try {
          const out = await def.run(ctx, input);
          const page = (ctx as { page?: Page }).page;
          if (def.screenshot && page) await test.info().attach(def.screenshot, { body: await page.screenshot(), contentType: 'image/png' });
          return out;
        } catch (e) {
          throw e instanceof StepError ? e : new StepError(def.portal, def.name, e);
        }
      },
      { box: true },
    );
  return Object.assign(run, { [STEP]: { name: def.name, portal: def.portal } });
};

/** True for what {@link defineStep} returns. */
export const isStep = (value: unknown): value is Step<StepContext, unknown, unknown> => typeof value === 'function' && STEP in value;

/** The name and portal of a step. */
export const stepMeta = (step: { readonly [STEP]: { name: string; portal: string } }) => step[STEP];
