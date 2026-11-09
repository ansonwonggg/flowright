import assert from 'node:assert/strict';

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object';

const withoutUndefined = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(withoutUndefined);
  if (isObject(v) && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(Object.entries(v).flatMap(([k, x]) => (x === undefined ? [] : [[k, withoutUndefined(x)]])));
  return v;
};

const subset = (actual: unknown, expected: unknown): boolean => {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => subset(actual[i], e));
  if (isObject(expected)) return isObject(actual) && Object.entries(expected).every(([k, e]) => subset(actual[k], e));
  return Object.is(actual, expected);
};

const matchers = (actual: unknown, negate: boolean) => {
  const check = (pass: boolean, message: string) => {
    if (pass === negate) assert.fail(`${negate ? 'not ' : ''}${message}`);
  };
  const show = (v: unknown) => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  return {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`),
    toEqual: (expected: unknown) => {
      let pass = true;
      try {
        assert.deepStrictEqual(withoutUndefined(actual), withoutUndefined(expected));
      } catch (e) {
        if (!negate) throw e;
        pass = false;
      }
      check(pass, `expected ${show(actual)} to equal ${show(expected)}`);
    },
    toBeUndefined: () => check(actual === undefined, `expected ${show(actual)} to be undefined`),
    toContain: (item: unknown) =>
      check(typeof actual === 'string' ? actual.includes(String(item)) : Array.isArray(actual) && actual.includes(item), `expected ${show(actual)} to contain ${show(item)}`),
    toHaveLength: (n: number) => check((actual as { length?: number })?.length === n, `expected length ${n}, got ${(actual as { length?: number })?.length}`),
    toHaveProperty: (key: string, ...value: unknown[]) =>
      check(isObject(actual) && key in actual && (value.length === 0 || subset(actual[key], value[0])), `expected ${show(actual)} to have property ${key}`),
    toMatch: (pattern: RegExp | string) =>
      check(typeof actual === 'string' && (typeof pattern === 'string' ? actual.includes(pattern) : pattern.test(actual)), `expected ${show(actual)} to match ${pattern}`),
    toMatchObject: (expected: unknown) => check(subset(actual, expected), `expected ${show(actual)} to match ${show(expected)}`),
    toThrow: (pattern?: RegExp | string) => {
      let error: unknown;
      try {
        (actual as () => unknown)();
      } catch (e) {
        error = e;
      }
      const text = error instanceof Error ? error.message : String(error);
      const pass = error !== undefined && (pattern === undefined || (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)));
      check(pass, `expected a throw${pattern ? ` matching ${pattern}` : ''}, got ${error === undefined ? 'none' : text}`);
    },
  };
};

/** The subset of Playwright's `expect` the moved tests use, on top of `node:assert`. */
export const expect = (actual: unknown) => ({ ...matchers(actual, false), not: matchers(actual, true) });
