import { reddit, redis } from '@devvit/web/server';
import type { Peek } from '../../shared/api';

/*
 *   peek:{sub}   string   JSON Peek, or "null" after a failed lookup. Expires so it stays fresh.
 */
const FRESH_S = 6 * 60 * 60;
const RETRY_S = 30 * 60;

const isPeek = (v: unknown): v is Peek => typeof v === 'object' && v !== null && 'name' in v && 'top' in v;

const lookup = async (sub: string): Promise<Peek | null> => {
  const info = await reddit.getSubredditInfoByName(sub);
  if (info.isNsfw || info.isQuarantined) return null;
  let top: Peek['top'] = null;
  try {
    const posts = await reddit.getTopPosts({ subredditName: sub, timeframe: 'week', limit: 10, pageSize: 10 }).all();
    const best = posts.find((p) => !p.nsfw && !p.spoiler && !p.stickied && p.title.length <= 200);
    if (best) top = { title: best.title, score: best.score, comments: best.numberOfComments };
  } catch (err) {
    console.warn(`peek: top posts for r/${sub} failed`, err);
  }
  return { name: info.name ?? sub, members: info.subscribersCount ?? null, online: info.activeCount ?? null, top };
};

/** Members, people online and this week's top post for a sub. Never throws. */
export const peek = async (sub: string): Promise<Peek | null> => {
  const key = `peek:${sub}`;
  const cached = await redis.get(key);
  if (cached) {
    try {
      const v: unknown = JSON.parse(cached);
      return isPeek(v) ? v : null;
    } catch {
      // fall through and refetch
    }
  }
  let result: Peek | null = null;
  try {
    result = await lookup(sub);
  } catch (err) {
    console.warn(`peek: r/${sub} failed`, err);
  }
  await redis.set(key, JSON.stringify(result));
  await redis.expire(key, result ? FRESH_S : RETRY_S);
  return result;
};
