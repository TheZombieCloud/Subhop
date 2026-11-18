import { redis } from '@devvit/web/server';
import type { Crowd, LeaderboardRow, NodeView, PathStat, Puzzle, Results, Run, Tally } from '../../shared/api';
import { avatarOf } from './avatars';
import { passportSummary, runTag } from './passport';
import { puzzlePool } from '../../shared/graph';
import {
  activeHome,
  buildPuzzle,
  homePuzzle,
  homeSideFor,
  hopsLeft,
  netFor,
  optimalRoute,
  parseExits,
  parseTwist,
  twistKindFor,
} from './net';
import type { TwistKind } from './net';

/*
 * Redis schema. Devvit Redis can't enumerate keys, so every key is derivable
 * from the puzzle id (YYYY-MM-DD or test-<ts>), the post id, or the username.
 *
 *   puzzle:{pid}        hash   start, target, par, number, twist (JSON|''), home 'start'|'end'|'',
 *                              homeExits (JSON), by (proposer username|'')
 *   post:{postId}       string pid this post plays
 *   run:{pid}:{user}    string JSON Run
 *   lb:{pid}            zset   user -> hops * 1e9 + timeMs  (ascending = best)
 *   paths:{pid}         zset   "a>b>c" -> times taken (finished runs only)
 *   first:{pid}         hash   exit -> players whose very first move was this exit
 *   hops:{pid}          hash   hops -> finishers with that final score
 *   streak:{user}       hash   last (pid date), count
 */

import { dailyNumber, DAY_MS, isDailyId, todayId } from './days';
import { winningProposal } from './proposals';
import { count, countQuit, countWrong } from './stats';

export { dailyNumber, todayId } from './days';
const SCORE_HOP = 1e9;
export const MAX_HOPS = 40;

const poolEntry = (n: number) => puzzlePool[(((n - 1) % puzzlePool.length) + puzzlePool.length) % puzzlePool.length]!;

export const getPuzzle = async (pid: string): Promise<Puzzle> => {
  const stored = await redis.hGetAll(`puzzle:${pid}`);
  if (stored.start && stored.target && stored.par && stored.number) {
    return {
      id: pid,
      start: stored.start,
      target: stored.target,
      par: Number(stored.par),
      // Dailies take their number from the community's own first day, so a post stored
      // before that rule (or on another count) still reads right.
      number: isDailyId(pid) ? await dailyNumber(pid) : Number(stored.number),
      twist: parseTwist(stored.twist),
      home: stored.home === 'start' ? 'start' : stored.home === 'end' || stored.home === '1' ? 'end' : null,
      homeExits: parseExits(stored.homeExits),
      by: stored.by || null,
    };
  }
  // A daily is, in order of preference: yesterday's most-voted player proposal, a home
  // journey if mods switched one on, or the global pool. Then it's frozen in Redis so
  // later config changes or votes can't move it.
  const raw = await dailyNumber(pid);
  const number = Number.isFinite(raw) ? raw : 1;
  const home = await activeHome();
  const side = home ? homeSideFor(home.mode, number) : null;
  const proposal = await winningProposal(pid, home, side);
  const base = proposal ?? (home && side && homePuzzle(home, side, number)) ?? poolEntry(number);
  const puzzle = buildPuzzle({ id: pid, number, ...base }, home, twistKindFor(pid));
  await savePuzzle(puzzle);
  return puzzle;
};

export const savePuzzle = async (p: Puzzle): Promise<void> => {
  await redis.hSet(`puzzle:${p.id}`, {
    start: p.start,
    target: p.target,
    par: String(p.par),
    number: String(p.number),
    twist: p.twist ? JSON.stringify(p.twist) : '',
    home: p.home ?? '',
    homeExits: JSON.stringify(p.homeExits),
    by: p.by ?? '',
  });
};

const TEST_TWISTS: (TwistKind | null)[] = [null, 'avoid', 'via', 'noback'];

/** Random puzzle for playtesting: home-bound if configured, with a random twist (or none). */
export const randomTestPuzzle = async (): Promise<Puzzle> => {
  const n = 1 + Math.floor(Math.random() * puzzlePool.length);
  const home = await activeHome();
  const side = home ? homeSideFor(home.mode, n) : null;
  const base = (home && side && homePuzzle(home, side, n)) ?? poolEntry(n);
  const kind = TEST_TWISTS[Math.floor(Math.random() * TEST_TWISTS.length)] ?? null;
  return buildPuzzle({ id: `test-${Date.now()}`, number: 0, ...base }, home, kind);
};

export const puzzleIdForPost = async (postId: string | undefined): Promise<string> => {
  if (postId) {
    const pid = await redis.get(`post:${postId}`);
    if (pid) return pid;
  }
  return todayId();
};

export const linkPost = async (postId: string, pid: string): Promise<void> => {
  await redis.set(`post:${postId}`, pid);
};

export const nodeView = (puzzle: Puzzle, name: string): NodeView => {
  const net = netFor(puzzle);
  return { name, description: net.describe(name), exits: net.exits(name) };
};

// ---- runs ----
const runKey = (pid: string, user: string) => `run:${pid}:${user}`;

export const getRun = async (pid: string, user: string): Promise<Run | null> => {
  const raw = await redis.get(runKey(pid, user));
  return raw ? (JSON.parse(raw) as Run) : null;
};

const saveRun = async (pid: string, user: string, run: Run) => {
  await redis.set(runKey(pid, user), JSON.stringify(run));
};

export const startRun = async (puzzle: Puzzle, user: string): Promise<Run> => {
  const existing = await getRun(puzzle.id, user);
  if (existing) return existing; // one attempt only
  const run: Run = { status: 'playing', path: [puzzle.start], hops: 0, startedAt: Date.now() };
  await saveRun(puzzle.id, user, run);
  await count(puzzle.id, 'started');
  return run;
};

export type HopOutcome = { ok: true; run: Run } | { ok: false; error: string };

export const hop = async (puzzle: Puzzle, user: string, to: string): Promise<HopOutcome> => {
  const run = await getRun(puzzle.id, user);
  if (!run || run.status !== 'playing') return { ok: false, error: 'No run in progress' };
  const here = run.path[run.path.length - 1]!;
  const net = netFor(puzzle);
  if (!net.has(to) || !net.exits(here).includes(to)) return { ok: false, error: `r/${to} isn't an exit from r/${here}` };
  const { twist } = puzzle;
  if (twist?.kind === 'avoid' && to === twist.sub) return { ok: false, error: `r/${to} is closed today` };
  if (twist?.kind === 'via' && to === puzzle.target && !run.path.includes(twist.sub)) {
    return { ok: false, error: `Pass through r/${twist.sub} first` };
  }

  if (run.hops === 0) await redis.hIncrBy(`first:${puzzle.id}`, to, 1);
  const closer = hopsLeft(puzzle, [...run.path, to]) < hopsLeft(puzzle, run.path);
  run.moves = (run.moves ?? '') + (closer ? 'c' : 's');
  if (!closer) await countWrong(puzzle.id, here, to);
  run.path.push(to);
  run.hops += 1;
  if (to === puzzle.target) {
    run.status = 'finished';
    run.finishedAt = Date.now();
    await recordFinish(puzzle, user, run);
  } else if (run.hops >= MAX_HOPS) {
    run.status = 'gaveup';
    run.finishedAt = Date.now();
    await count(puzzle.id, 'gaveup');
    await countQuit(puzzle.id, to);
  }
  await saveRun(puzzle.id, user, run);
  return { ok: true, run };
};

export const stepBack = async (puzzle: Puzzle, user: string): Promise<HopOutcome> => {
  const run = await getRun(puzzle.id, user);
  if (!run || run.status !== 'playing') return { ok: false, error: 'No run in progress' };
  if (puzzle.twist?.kind === 'noback') return { ok: false, error: 'No stepping back today' };
  if (run.path.length < 2) return { ok: false, error: 'Already at the start' };
  run.path.pop();
  run.hops += 1; // stepping back costs a hop
  run.moves = (run.moves ?? '') + 'b';
  await saveRun(puzzle.id, user, run);
  return { ok: true, run };
};

export const giveUp = async (puzzle: Puzzle, user: string): Promise<Run | null> => {
  const run = await getRun(puzzle.id, user);
  if (!run || run.status !== 'playing') return run;
  run.status = 'gaveup';
  run.finishedAt = Date.now();
  await saveRun(puzzle.id, user, run);
  await count(puzzle.id, 'gaveup');
  await countQuit(puzzle.id, run.path[run.path.length - 1]!);
  return run;
};

const runTime = (run: Run) => (run.finishedAt ?? Date.now()) - run.startedAt;

const recordFinish = async (puzzle: Puzzle, user: string, run: Run) => {
  const timeMs = runTime(run);
  await redis.zAdd(`lb:${puzzle.id}`, { member: user, score: run.hops * SCORE_HOP + timeMs });
  await redis.zIncrBy(`paths:${puzzle.id}`, run.path.join('>'), 1);
  await redis.hIncrBy(`hops:${puzzle.id}`, String(run.hops), 1);
  if (isDailyId(puzzle.id)) await bumpStreak(user, puzzle.id, run);
};

/**
 * Testing aid for mods: forget a user's run on a puzzle so they can play it again.
 * Undoes the leaderboard, route and score tallies. The first-move tally and the
 * streak are left alone (the first move isn't stored per run).
 */
export const resetRun = async (pid: string, user: string): Promise<boolean> => {
  const run = await getRun(pid, user);
  if (!run) return false;
  if (run.status === 'finished') {
    await redis.zRem(`lb:${pid}`, [user]);
    await redis.zIncrBy(`paths:${pid}`, run.path.join('>'), -1);
    await redis.hIncrBy(`hops:${pid}`, String(run.hops), -1);
  }
  if (run.status === 'gaveup') {
    await count(pid, 'gaveup', -1);
    await countQuit(pid, run.path[run.path.length - 1]!, -1);
  }
  await count(pid, 'started', -1);
  await redis.del(runKey(pid, user));
  return true;
};

// ---- streaks ----
// Only a daily played on its own day counts (a run that started that day may finish after
// midnight). Older dailies stay playable, but they can't build a streak or break one.
const bumpStreak = async (user: string, pid: string, run: Run) => {
  if (todayId(run.startedAt) !== pid) return;
  const s = await redis.hGetAll(`streak:${user}`);
  if (s.last && s.last >= pid) return;
  const yesterday = todayId(Date.parse(pid) - DAY_MS);
  const count = s.last === yesterday ? Number(s.count ?? 0) + 1 : 1;
  await redis.hSet(`streak:${user}`, { last: pid, count: String(count) });
};

export const getStreak = async (user: string): Promise<number> => {
  const s = await redis.hGetAll(`streak:${user}`);
  if (!s.last) return 0;
  const today = todayId();
  const yesterday = todayId(Date.now() - DAY_MS);
  return s.last === today || s.last === yesterday ? Number(s.count ?? 0) : 0;
};

// ---- leaderboard & results ----
const decode = (score: number) => ({ hops: Math.floor(score / SCORE_HOP), timeMs: score % SCORE_HOP });

export const playerCount = (pid: string) => redis.zCard(`lb:${pid}`);

export const leaderboard = async (pid: string, start: number, stop: number): Promise<LeaderboardRow[]> => {
  const rows = await redis.zRange(`lb:${pid}`, start, stop, { by: 'rank' });
  return Promise.all(
    rows.map(async (r, i) => ({ rank: start + i + 1, username: r.member, ...decode(r.score), avatar: await avatarOf(r.member) }))
  );
};

export const myRow = async (pid: string, user: string): Promise<LeaderboardRow | null> => {
  const [rank, score] = await Promise.all([redis.zRank(`lb:${pid}`, user), redis.zScore(`lb:${pid}`, user)]);
  if (rank === undefined || score === undefined) return null;
  return { rank: rank + 1, username: user, ...decode(score), avatar: await avatarOf(user) };
};

const pathStats = async (pid: string): Promise<PathStat[]> => {
  const rows = await redis.zRange(`paths:${pid}`, 0, 999, { by: 'rank', reverse: true });
  return rows.map((r) => {
    const path = r.member.split('>');
    return { path, hops: path.length - 1, count: r.score };
  });
};

const notable = (stats: PathStat[]): { mostCommon: PathStat | null; weirdest: PathStat | null } => {
  if (!stats.length) return { mostCommon: null, weirdest: null };
  const mostCommon = [...stats].sort((a, b) => b.count - a.count || a.hops - b.hops)[0]!;
  // Weirdest: the rarest, longest route that still made it — and isn't the most common one.
  const others = stats.filter((s) => s !== mostCommon);
  const weirdest = others.length ? [...others].sort((a, b) => a.count - b.count || b.hops - a.hops)[0]! : null;
  return { mostCommon, weirdest };
};

const byCount = (a: Tally, b: Tally) => b.count - a.count || a.name.localeCompare(b.name);

const crowdStats = async (
  puzzle: Puzzle,
  run: Run,
  stats: PathStat[],
  rank: number | null,
  players: number
): Promise<Crowd> => {
  const [firstRaw, hopsRaw] = await Promise.all([
    redis.hGetAll(`first:${puzzle.id}`),
    redis.hGetAll(`hops:${puzzle.id}`),
  ]);

  const firstMoves = netFor(puzzle)
    .exits(puzzle.start)
    .map((name) => ({ name, count: Number(firstRaw[name] ?? 0) }))
    .sort(byCount);
  const firstTotal = firstMoves.reduce((n, t) => n + t.count, 0);

  const hopCounts = Object.entries(hopsRaw)
    .map(([h, c]) => ({ hops: Number(h), count: Number(c) }))
    .filter((h) => Number.isFinite(h.hops) && h.count > 0)
    .sort((a, b) => a.hops - b.hops);

  const via = new Map<string, number>();
  let finishers = 0;
  for (const s of stats) {
    finishers += s.count;
    for (const n of new Set(s.path.slice(1, -1))) via.set(n, (via.get(n) ?? 0) + s.count);
  }
  const hubs = [...via].map(([name, count]) => ({ name, count })).sort(byCount).slice(0, 3);

  const finished = run.status === 'finished';
  const mine = finished ? stats.find((s) => s.path.join('>') === run.path.join('>')) : undefined;

  return {
    finishers,
    hopCounts,
    firstMoves,
    firstTotal,
    hubs,
    sameRoute: finished ? Math.max(0, (mine?.count ?? 1) - 1) : null,
    topPct: finished && rank && players > 1 ? Math.max(1, Math.ceil((rank / players) * 100)) : null,
  };
};

export const results = async (puzzle: Puzzle, user: string, run: Run): Promise<Results> => {
  const [top, me, players, stats] = await Promise.all([
    leaderboard(puzzle.id, 0, 2),
    myRow(puzzle.id, user),
    playerCount(puzzle.id),
    pathStats(puzzle.id),
  ]);
  const rank = me?.rank ?? null;
  const [rival, passport] = await Promise.all([
    rank && rank > 1 ? leaderboard(puzzle.id, rank - 2, rank - 2).then((r) => r[0] ?? null) : Promise.resolve(null),
    passportSummary(user, runTag(puzzle.id, run)),
  ]);
  return {
    run,
    timeMs: runTime(run),
    rank,
    myAvatar: me?.avatar ?? null,
    rival,
    passport,
    players,
    top,
    ...notable(stats),
    optimal: optimalRoute(netFor(puzzle), puzzle.start, puzzle.target, puzzle.twist),
    crowd: await crowdStats(puzzle, run, stats, rank, players),
  };
};
