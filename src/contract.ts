import { readValue, type Fields } from './fields.ts';
import type { Values } from './values.ts';

/** Whether a function input must be given (by the flow, by hand, or from its record) or may be left out. */
export type Need = 'required' | 'optional';

/** The part of a function a contract check needs. */
export type Contract = { id: string; fields: Fields; inputs: Record<string, Need>; outputs: readonly string[] };

/**
 * The inputs `run` gets: only the declared names, each checked against the registry, JSON fields parsed.
 *
 * @throws one error listing every problem: a required input missing, or a value breaking its field rule.
 */
export const prepareInput = (fn: Contract, raw: Values): Record<string, unknown> => {
  const problems: string[] = [];
  const input: Record<string, unknown> = {};
  for (const [name, need] of Object.entries(fn.inputs)) {
    const text = raw[name]?.trim();
    if (!text) {
      if (need === 'required') problems.push(`missing ${name} (${fn.fields[name]?.label ?? name})`);
      continue;
    }
    const read = readValue(name, fn.fields[name], text);
    if ('problem' in read) problems.push(read.problem);
    else input[name] = read.value;
  }
  if (problems.length) throw new Error(`${fn.id} can't start:\n- ${problems.join('\n- ')}`);
  return input;
};

const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * What `run` returned, checked and turned back into text: only declared names, strings (or any value for
 * a JSON field), each matching its field rule. Empty and `undefined` values are dropped, so an optional
 * output can be left out.
 *
 * @throws one error listing every problem; a function that returns what it didn't declare is a bug.
 */
export const checkOutput = (fn: Contract, returned: unknown): Values => {
  if (!returned || typeof returned !== 'object' || Array.isArray(returned)) throw new Error(`${fn.id} must return an object of named outputs`);
  const problems: string[] = [];
  const output: Values = {};
  for (const [name, value] of Object.entries(returned)) {
    if (value === undefined || value === '') continue;
    const f = fn.fields[name];
    if (!fn.outputs.includes(name)) problems.push(`returned "${name}", which isn't in its outputs`);
    else if (typeof value !== 'string' && f?.kind !== 'json') problems.push(`${name} must be a string, got ${typeof value}`);
    else {
      const read = readValue(name, f, asText(value));
      if ('problem' in read) problems.push(read.problem);
      else output[name] = asText(value);
    }
  }
  if (problems.length) throw new Error(`${fn.id} returned bad output:\n- ${problems.join('\n- ')}`);
  return output;
};

/** `values` with every secret field shown as `••••`, for logs and reports. */
export const masked = (fields: Fields, values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fields[k]?.kind === 'secret' ? '••••' : v]));
