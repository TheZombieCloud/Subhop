import { context, reddit, redis } from '@devvit/web/server';

/*
 * Two small ties back into the subreddit:
 *
 *   followers   hash  username -> '1' once they tapped Follow on the results page
 *   flair:ours  hash  username -> the streak flair text we last set for them
 *
 * Streak flair is only ever written over flair we set ourselves (or no flair), so a
 * flair the member picked, or a mod gave them, is never replaced.
 */

export const isFollowing = async (username: string): Promise<boolean> =>
  (await redis.hGet('followers', username)) === '1';

/** True if subscribed. False if Reddit hasn't granted the app SUBSCRIBE_TO_SUBREDDIT. */
export const follow = async (username: string): Promise<boolean> => {
  try {
    await reddit.subscribeToCurrentSubreddit();
  } catch (error) {
    if (String(error).includes('permission not granted')) return false;
    throw error;
  }
  await redis.hSet('followers', { [username]: '1' });
  return true;
};

export const streakFlairText = (streak: number): string =>
  `Subhop · ${streak}-day streak`;

export const updateStreakFlair = async (username: string, streak: number): Promise<void> => {
  const subredditName = context.subredditName;
  if (!subredditName || streak < 1) return;
  try {
    const text = streakFlairText(streak);
    const [ours, sub] = await Promise.all([redis.hGet('flair:ours', username), reddit.getCurrentSubreddit()]);
    const current = (await sub.getUserFlair({ usernames: [username] })).users[0]?.flairText ?? '';
    if (current === text) return;
    if (current && current !== ours) return; // their own flair: leave it alone
    await reddit.setUserFlair({ subredditName, username, text, backgroundColor: '#1d2b4a', textColor: 'light' });
    await redis.hSet('flair:ours', { [username]: text });
  } catch (error) {
    console.warn('streak flair failed', error);
  }
};
