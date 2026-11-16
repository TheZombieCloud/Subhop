import { redis } from '@devvit/web/server';

export const DAY_MS = 86_400_000;

export const todayId = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

export const dayAfter = (id: string): string => todayId(Date.parse(id) + DAY_MS);
export const dayBefore = (id: string): string => todayId(Date.parse(id) - DAY_MS);

/**
 * Each community counts its own dailies: the first day the app ran there is Daily #1.
 * Redis is per installation, so this is per subreddit. Set once, never moved.
 */
export const firstDay = async (): Promise<string> => {
  const today = todayId();
  await redis.set('firstDay', today, { nx: true });
  return (await redis.get('firstDay')) ?? today;
};

export const dailyNumber = async (id: string): Promise<number> =>
  Math.floor((Date.parse(id) - Date.parse(await firstDay())) / DAY_MS) + 1;

export const isDailyId = (id: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(id);
