/** Named string values passed into or out of a function. */
export type Values = Record<string, string>;

/** Env var holding a function's inputs as a JSON object; set by the flow runner or by hand. */
export const INPUT_ENV = 'FLOWKIT_INPUT';

/**
 * Values as text: strings trimmed, objects and arrays (a JSON field written inline, e.g. in a flow file)
 * as JSON text. Empty strings, empty objects and arrays, numbers, booleans and `null` are dropped: they
 * mean "not given".
 */
export const cleanValues = (values: Record<string, unknown>): Values =>
  Object.fromEntries(
    Object.entries(values).flatMap(([k, v]): [string, string][] => {
      if (typeof v === 'string') return v.trim() ? [[k, v.trim()]] : [];
      return v && typeof v === 'object' && Object.keys(v).length ? [[k, JSON.stringify(v)]] : [];
    }),
  );

/**
 * Parses an input JSON object; see {@link cleanValues}.
 *
 * @returns `{}` when `raw` is unset or blank.
 * @throws when `raw` isn't a JSON object.
 */
export const parseValues = (raw: string | undefined, source = INPUT_ENV): Values => {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not JSON: ${raw.slice(0, 80)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${source} must be a JSON object of named values`);
  return cleanValues(parsed as Record<string, unknown>);
};
