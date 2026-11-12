const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const hostnameOf = (value: string, withScheme: boolean): string | undefined => {
  try {
    return new URL(withScheme ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const isLocal = (hostname: string | undefined) => Boolean(hostname && LOCAL_HOSTS.has(hostname));

/**
 * Why the app server should refuse a request, or `undefined` to serve it.
 *
 * - The `Host` must name this machine (`localhost`, `127.0.0.1`, `[::1]`, any port), which stops a web page
 *   from reaching the app through a DNS name it rebinds to 127.0.0.1.
 * - A request that isn't a GET or HEAD must carry no `Origin` or a local one, which stops another site from
 *   starting runs or saving files through a form or `fetch`. Browsers send `Origin` on every cross-site POST;
 *   curl and Node `fetch` send none.
 */
export const blockedRequest = (method: string | undefined, headers: { host?: string; origin?: string }): string | undefined => {
  if (!isLocal(hostnameOf(headers.host ?? '', false))) return `Host "${headers.host ?? ''}" is not this machine; the app only answers on localhost.`;
  if (method === 'GET' || method === 'HEAD' || headers.origin === undefined) return undefined;
  return isLocal(hostnameOf(headers.origin, true)) ? undefined : `Origin "${headers.origin}" is not this app; only its own page may change things.`;
};
