import { useEffect, useState } from 'react';

/** Re-renders every `everyMs` and returns the current time. */
export const useNow = (everyMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
};

/** Daily puzzles roll over at midnight UTC (same as the scheduler cron). */
export const msToNextPuzzle = (now: number): number => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
};

export const fmtCountdown = (ms: number): string => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

export const pct = (n: number, total: number): string => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');
