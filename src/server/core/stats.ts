import { redis } from '@devvit/web/server';

/*
 * Per-puzzle counters, so a mod can see where a puzzle loses players.
 * Anonymous tallies only: no usernames.
 *
 *   stats:{pid}   hash   views (feed card loads), opens (game screen loads), started, gaveup
 *   quit:{pid}    hash   community -> runs given up while standing there
 *   wrong:{pid}   hash   "from>to" -> hops along that exit that didn't get closer
 *
 * Finished runs are already counted by lb:{pid} and hops:{pid} (see game.ts).
 * Counting must never break play, so every write swallows its own errors.
 */

export type StatField = 'views' | 'opens' | 'started' | 'gaveup';

const quietly = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    console.warn('stats write failed', error);
  }
};

export const count = (pid: string, field: StatField, by = 1) => quietly(() => redis.hIncrBy(`stats:${pid}`, field, by));
export const countQuit = (pid: string, sub: string, by = 1) => quietly(() => redis.hIncrBy(`quit:${pid}`, sub, by));
export const countWrong = (pid: string, from: string, to: string) =>
  quietly(() => redis.hIncrBy(`wrong:${pid}`, `${from}>${to}`, 1));

export const statKeys = (pid: string): string[] => [`stats:${pid}`, `quit:${pid}`, `wrong:${pid}`];

const top = (raw: Record<string, string>, n: number) =>
  Object.entries(raw)
    .map(([name, c]) => ({ name, count: Number(c) }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);

/** A plain-text report for the mod menu. */
export const puzzleReport = async (pid: string): Promise<string> => {
  const [stats, quit, wrong, hops, finished] = await Promise.all([
    redis.hGetAll(`stats:${pid}`),
    redis.hGetAll(`quit:${pid}`),
    redis.hGetAll(`wrong:${pid}`),
    redis.hGetAll(`hops:${pid}`),
    redis.zCard(`lb:${pid}`),
  ]);
  const n = (k: StatField) => Number(stats[k] ?? 0);
  const started = n('started');
  const gaveUp = n('gaveup');
  const lines = [`Feed card loads: ${n('views')}`, `Game opens: ${n('opens')}`];
  // Runs from before these counters existed were never counted as started.
  if (started >= finished + gaveUp) {
    lines.push(
      `Started: ${started}`,
      `Finished: ${finished}`,
      `Gave up: ${gaveUp}`,
      `Left without finishing: ${started - finished - gaveUp}`
    );
  } else {
    lines.push(`Finished: ${finished}`, `Gave up: ${gaveUp}`, 'Started: not counted for runs before this report existed');
  }
  const spread = top(hops, 99).sort((a, b) => Number(a.name) - Number(b.name));
  if (spread.length) lines.push(`Hops to finish: ${spread.map((h) => `${h.name} hops × ${h.count}`).join(', ')}`);
  const quits = top(quit, 3);
  if (quits.length) lines.push(`Gave up in: ${quits.map((q) => `r/${q.name} × ${q.count}`).join(', ')}`);
  const wrongs = top(wrong, 3);
  if (wrongs.length) {
    lines.push(`Most common wrong turns: ${wrongs.map((w) => `r/${w.name.replace('>', ' to r/')} × ${w.count}`).join(', ')}`);
  }
  return lines.join('\n');
};
