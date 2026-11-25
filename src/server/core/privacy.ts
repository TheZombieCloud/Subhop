import { context, reddit, redis } from '@devvit/web/server';
import { dayAfter, firstDay, todayId } from './days';
import { resetRun } from './game';

/*
 * "Delete my Subhop data": everything this subreddit's Subhop stores about one player.
 *
 *   run:{day}:{user}, and their place in lb/paths/hops for that day   every daily since the first
 *   puzzle:{day} "by"                                                   their name on dailies they picked
 *   passport:{user}, streak:{user}, avatar:{user}
 *   followers, flair:ours                                               their entry
 *   propvote / propmine / props / propby for tomorrow                   their vote and proposal
 *   their user flair, only if it's the streak flair Subhop set
 *
 * Left alone: anonymous tallies (first moves) and test-post runs (their ids can't be listed).
 * Titles of posts already made can't be edited, so "picked by u/name" stays in those titles;
 * the app itself stops showing it. Their own comments are theirs to delete.
 */

const MAX_DAYS = 1000;

export const deleteUserData = async (user: string): Promise<void> => {
  const end = dayAfter(todayId());
  for (let day = await firstDay(), i = 0; day <= end && i < MAX_DAYS; day = dayAfter(day), i++) {
    await resetRun(day, user);
    if ((await redis.hGet(`puzzle:${day}`, 'by')) === user) await redis.hSet(`puzzle:${day}`, { by: '' });
  }

  const tomorrow = end;
  const [voted, mine] = await Promise.all([
    redis.hGet(`propvote:${tomorrow}`, user),
    redis.hGet(`propmine:${tomorrow}`, user),
  ]);
  if (voted) await redis.zIncrBy(`props:${tomorrow}`, voted, -1);
  if (mine) {
    await redis.zRem(`props:${tomorrow}`, [mine]);
    await redis.hDel(`propby:${tomorrow}`, [mine]);
  }
  await redis.hDel(`propvote:${tomorrow}`, [user]);
  await redis.hDel(`propmine:${tomorrow}`, [user]);

  const ours = await redis.hGet('flair:ours', user);
  const subredditName = context.subredditName;
  if (ours && subredditName) {
    try {
      const sub = await reddit.getCurrentSubreddit();
      const current = (await sub.getUserFlair({ usernames: [user] })).users[0]?.flairText ?? '';
      if (current === ours) await reddit.removeUserFlair(subredditName, user);
    } catch (error) {
      console.warn('flair removal failed', error);
    }
  }

  await redis.del(`passport:${user}`, `streak:${user}`, `avatar:${user}`);
  await redis.hDel('followers', [user]);
  await redis.hDel('flair:ours', [user]);
};
