import { reddit, redis } from '@devvit/web/server';

/*
 *   icon:{sub}   string   community icon URL, or "" when there is none / the lookup failed.
 */
const HIT_S = 7 * 24 * 60 * 60;
const MISS_S = 24 * 60 * 60;

/** Only Reddit-hosted images; anything else is dropped. */
const clean = (url: string | undefined): string => {
  if (!url) return '';
  const u = url.replace(/&amp;/g, '&');
  try {
    const host = new URL(u).hostname;
    return host.endsWith('.redditmedia.com') || host.endsWith('.redd.it') ? u : '';
  } catch {
    return '';
  }
};

const lookup = async (sub: string): Promise<string> => {
  try {
    const info = await reddit.getSubredditInfoByName(sub);
    if (!info.id || info.isNsfw || info.isQuarantined) return '';
    const styles = await reddit.getSubredditStyles(info.id);
    return clean(styles.icon);
  } catch (err) {
    console.warn(`icon: r/${sub} failed`, err);
    return '';
  }
};

/** Icon URLs for the given subs (null when a sub has none). Never throws. */
export const icons = async (subs: string[]): Promise<Record<string, string | null>> => {
  const out: Record<string, string | null> = {};
  await Promise.all(
    subs.map(async (sub) => {
      const key = `icon:${sub}`;
      let url = await redis.get(key);
      if (url === undefined || url === null) {
        url = await lookup(sub);
        await redis.set(key, url);
        await redis.expire(key, url ? HIT_S : MISS_S);
      }
      out[sub] = url || null;
    })
  );
  return out;
};
