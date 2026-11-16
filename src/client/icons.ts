import { useEffect, useState } from 'react';
import type { IconsResponse } from '../shared/api';
import { call } from './api';

/*
 * Community icons for stamps. Requests made in the same tick are batched into one
 * /api/icons call; results (including "no icon") are kept for the session.
 */
const known = new Map<string, string | null>();
const listeners = new Set<() => void>();
let queued = new Set<string>();
let scheduled = false;

const flush = async () => {
  scheduled = false;
  const subs = [...queued];
  queued = new Set();
  for (let i = 0; i < subs.length; i += 12) {
    const batch = subs.slice(i, i + 12);
    try {
      const r = await call<IconsResponse>(`icons?subs=${encodeURIComponent(batch.join(','))}`);
      for (const s of batch) known.set(s, r.icons[s] ?? null);
    } catch {
      for (const s of batch) known.set(s, null);
    }
  }
  for (const l of listeners) l();
};

const request = (sub: string) => {
  if (known.has(sub) || queued.has(sub)) return;
  queued.add(sub);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => void flush());
  }
};

/** Icon URL for a sub: undefined while loading, null if it has none. */
export const useIcon = (sub: string): string | null | undefined => {
  const [, bump] = useState(0);
  useEffect(() => {
    if (known.has(sub)) return;
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    request(sub);
    return () => {
      listeners.delete(l);
    };
  }, [sub]);
  return known.get(sub);
};

/** An icon that failed to load in the browser is treated as missing from then on. */
export const markBroken = (sub: string) => {
  known.set(sub, null);
  for (const l of listeners) l();
};
