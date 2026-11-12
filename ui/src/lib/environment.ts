/** How messages name where a run makes its changes: the environment, or a neutral phrase when there is none. */
export const targetOf = (env: string | null | undefined): string => (env ? `the ${env} environment` : 'the system under test');
