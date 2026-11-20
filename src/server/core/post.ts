import { reddit, redis } from '@devvit/web/server';
import type { Puzzle } from '../../shared/api';
import { getPuzzle, linkPost, randomTestPuzzle, savePuzzle, todayId } from './game';

const TWIST_TAG = { avoid: 'Border closed', via: 'Detour', noback: 'No return' } as const;

const titleFor = (puzzle: Puzzle, prefix: string) => {
  const tag = puzzle.twist ? ` · ${TWIST_TAG[puzzle.twist.kind]}` : '';
  const home = puzzle.home ? ' (home)' : '';
  const by = puzzle.by ? ` · picked by u/${puzzle.by}` : '';
  return `${prefix}: r/${puzzle.start} → r/${puzzle.target}${home}${tag}${by}`;
};

const createPuzzlePost = async (puzzle: Puzzle, title: string) => {
  const post = await reddit.submitCustomPost({
    title,
    textFallback: { text: `Get from r/${puzzle.start} to r/${puzzle.target} in as few hops as you can. Par ${puzzle.par}.` },
  });
  await linkPost(post.id, puzzle.id);
  return post;
};

/** Today's daily puzzle (used by the scheduler, install trigger and mod menu). */
export const createDailyPost = async () => {
  const puzzle = await getPuzzle(todayId());
  const post = await createPuzzlePost(puzzle, titleFor(puzzle, `Subhop #${puzzle.number}`));
  await redis.set(`posted:${puzzle.id}`, post.id);
  return post;
};

/**
 * Posts today's daily unless it's already up. The scheduler calls this at midnight UTC and
 * again every 15 minutes, so a missed or failed midnight run is made up for soon after.
 * Returns the new post's id, or null if today's was already posted.
 *
 *   posted:{day}   string   id of the daily post made for that day
 */
export const ensureDailyPost = async (): Promise<string | null> => {
  if (await redis.get(`posted:${todayId()}`)) return null;
  return (await createDailyPost()).id;
};

/** A random puzzle with its own fresh leaderboard, for playtesting. */
export const createTestPost = async () => {
  const puzzle = await randomTestPuzzle();
  await savePuzzle(puzzle);
  return createPuzzlePost(puzzle, titleFor(puzzle, 'Subhop (test)'));
};
