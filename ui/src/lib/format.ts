/** Milliseconds as `42s` or `3m05s`; `''` for missing, negative or NaN. */
export const duration = (ms: number | null | undefined): string => {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

/** How long ago `time` was, relative to `now`: `just now`, `5 min ago`, `3 h ago`, else the local date and time. */
export const ago = (time: string | number, now = Date.now()): string => {
  const minutes = Math.round((now - new Date(time).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(time).toLocaleString();
};

/** A start time as a short local date and time, e.g. `Nov 5, 03:53 PM`. */
export const when = (time: number): string => new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A record's summary without its ref and stage, e.g. `Other User @ PCCW etoe.abc`. */
export const who = (summary: string, ref: string): string =>
  summary
    .replace(ref, '')
    .replace(/·.*$/, '')
    .trim();
