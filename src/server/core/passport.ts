import { redis } from '@devvit/web/server';
import type { PassportSummary, Run } from '../../shared/api';
import { hasNode, nodeNames } from '../../shared/graph';

/*
 * Your passport: every community you've ever passed through, across all journeys.
 *
 *   passport:{user}   hash   sub -> the run where you first got its stamp: {pid}@{run start ms}
 *                             (older stamps hold just the pid)
 *
 * Only communities on the built-in map count towards the total, so "37 of 500"
 * means the same thing in every subreddit.
 */

const key = (user: string) => `passport:${user}`;

/** Which run a stamp came from. Per run, not per puzzle, so a replay (reset or re-roll) only counts its own stamps. */
export const runTag = (pid: string, run: Run): string => `${pid}@${run.startedAt}`;

/** Stamp a community into your passport. True if it's a new stamp. */
export const stamp = async (user: string, sub: string, tag: string): Promise<boolean> =>
  (await redis.hSetNX(key(user), sub, tag)) === 1;

export const passportTotal = (): number => nodeNames().length;

export const collectedSubs = async (user: string): Promise<string[]> =>
  (await redis.hKeys(key(user))).filter(hasNode);

/** Includes communities you stepped back out of: you still got their stamp. */
export const passportSummary = async (user: string, tag: string): Promise<PassportSummary> => {
  const all = await redis.hGetAll(key(user));
  const collected = Object.keys(all).filter(hasNode);
  const fresh = collected.filter((s) => all[s] === tag);
  return { collected: collected.length, total: passportTotal(), fresh };
};
