import { writeFileSync } from 'node:fs';
import { INPUT_ENV, parseValues, type Values } from './values.ts';

export { cleanValues, INPUT_ENV, parseValues, type Values } from './values.ts';

/** Env var naming the file a function writes its outputs to, as JSON. */
export const OUTPUT_ENV = 'FLOWKIT_OUTPUT';

/** This run's inputs from {@link INPUT_ENV}. */
export const readInput = (env: NodeJS.ProcessEnv = process.env): Values => parseValues(env[INPUT_ENV]);

/** Writes `values` to the {@link OUTPUT_ENV} file; does nothing when it is unset. */
export const writeOutput = (values: Values, env: NodeJS.ProcessEnv = process.env): void => {
  const file = env[OUTPUT_ENV];
  if (file) writeFileSync(file, JSON.stringify(values, null, 2));
};
