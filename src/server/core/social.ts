import { context, reddit, redis } from '@devvit/web/server';

/*
 * Small ties back into the subreddit:
 *
 *   scores:{postId}  string  id of the app's stickied "Results thread" comment on that post
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

const isCommentId = (id: string): id is `t1_${string}` => id.startsWith('t1_');

const SCORES_TEXT =
  '**Results thread.** Finished the journey? Press "Comment my result" on the results page ' +
  'and it is posted here as a reply from your own account. Routes are left out, so no spoilers.';

/**
 * The one stickied app comment on a post that players' results are posted under, so
 * result comments stay collapsed out of the way of the discussion. Made with the post;
 * made on first use for posts older than that.
 */
export const ensureScoreThread = async (postId: `t3_${string}`): Promise<`t1_${string}`> => {
  const key = `scores:${postId}`;
  const existing = await redis.get(key);
  if (existing && isCommentId(existing)) return existing;

  const comment = await reddit.submitComment({ id: postId, text: SCORES_TEXT, runAs: 'APP' });
  try {
    await comment.distinguish(true);
  } catch (error) {
    await comment.delete(); // never leave an unstickied one behind
    throw error;
  }
  // If two players got here at once, keep the first thread and drop ours.
  await redis.set(key, comment.id, { nx: true });
  const kept = await redis.get(key);
  if (kept && kept !== comment.id && isCommentId(kept)) {
    await comment.delete();
    return kept;
  }
  return comment.id;
};

/** Forget a results thread that can no longer be replied to (e.g. a mod deleted it). */
export const forgetScoreThread = async (postId: string): Promise<void> => {
  await redis.del(`scores:${postId}`);
};

/**
 * Give every Subhop post in this subreddit its results thread: dailies and test posts,
 * however old. Goes by the subreddit's own post list, since older dailies were never
 * recorded by day. Safe to run again: posts that already have one are skipped.
 */
export const backfillScoreThreads = async (): Promise<{ added: number; had: number; failed: number }> => {
  const out = { added: 0, had: 0, failed: 0 };
  const subredditName = context.subredditName;
  if (!subredditName) return out;
  const posts = await reddit.getNewPosts({ subredditName, limit: 1000, pageSize: 100 }).all();
  for (const post of posts) {
    if (!(await redis.get(`post:${post.id}`))) continue; // not one of ours
    if (await redis.get(`scores:${post.id}`)) {
      out.had++;
      continue;
    }
    try {
      await ensureScoreThread(post.id);
      out.added++;
    } catch (error) {
      console.warn(`results thread for ${post.id} failed`, error); // deleted, locked or archived post
      out.failed++;
    }
  }
  return out;
};
