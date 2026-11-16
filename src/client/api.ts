import type { ErrorResponse } from '../shared/api';

export const call = async <T,>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> => {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as ErrorResponse | null)?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
};

export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
