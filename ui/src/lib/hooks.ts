import { useEffect, useState } from 'react';

/** The current time, ticking every `ms` while `active`; frozen otherwise. */
export const useNow = (active: boolean, ms = 1000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return active ? now : Date.now();
};

/** Reads a per-browser preference; `null` when storage is unavailable or the key is unset. */
export const readPref = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Writes a per-browser preference; does nothing when storage is unavailable. */
export const writePref = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
};
