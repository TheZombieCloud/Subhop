import { reddit, redis } from '@devvit/web/server';

/*
 *   avatar:{user}   string   Snoovatar image URL, or "" when they have none / the lookup failed.
 */
const HIT_S = 24 * 60 * 60;
const MISS_S = 6 * 60 * 60;

const clean = (url: string | undefined): string => {
  if (!url) return '';
  try {
    const host = new URL(url).hostname;
    return host.endsWith('.redditmedia.com') || host.endsWith('.redd.it') ? url : '';
  } catch {
    return '';
  }
};

const lookup = async (user: string): Promise<string> => {
  try {
    return clean(await reddit.getSnoovatarUrl(user));
  } catch (err) {
    console.warn(`avatar: u/${user} failed`, err);
    return '';
  }
};

/** Avatar URL for one player (null if none). Cached; never throws. */
export const avatarOf = async (user: string): Promise<string | null> => {
  const key = `avatar:${user}`;
  let url = await redis.get(key);
  if (url === undefined || url === null) {
    url = await lookup(user);
    await redis.set(key, url);
    await redis.expire(key, url ? HIT_S : MISS_S);
  }
  return url || null;
};
