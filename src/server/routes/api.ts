import { Hono, type Context } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  BackResponse,
  ErrorResponse,
  FollowResponse,
  PassportResponse,
  GiveUpResponse,
  HopRequest,
  HopResponse,
  IconsResponse,
  InitResponse,
  LeaderboardResponse,
  PeekResponse,
  ProposalsResponse,
  ProposeRequest,
  ShareResponse,
  StartResponse,
  VoteRequest,
} from '../../shared/api';
import {
  getPuzzle,
  getRun,
  getStreak,
  giveUp,
  hop,
  leaderboard,
  myRow,
  nodeView,
  playerCount,
  puzzleIdForPost,
  results,
  startRun,
  stepBack,
} from '../core/game';
import { netFor } from '../core/net';
import { icons } from '../core/icons';
import { follow, isFollowing, updateStreakFlair } from '../core/social';
import { collectedSubs, passportSummary, passportTotal, runTag, stamp } from '../core/passport';
import { journeyRoutes, trackGiveUp, trackHop } from '../core/journey';
import { peek } from '../core/peek';
import { listProposals, propose, vote } from '../core/proposals';
import { count } from '../core/stats';

export const api = new Hono();

api.route('/telemetry', journeyRoutes);

const fail = (c: Context, message: string, code: 400 | 401 | 404 = 400) =>
  c.json<ErrorResponse>({ status: 'error', message }, code);

const current = async () => {
  const [username, pid] = await Promise.all([reddit.getCurrentUsername(), puzzleIdForPost(context.postId)]);
  const puzzle = await getPuzzle(pid);
  return { username: username ?? null, puzzle };
};

const times = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** How the run went, in plain words. Never names a community, so it can't spoil the route. */
const runStory = (moves: string): string => {
  const wrong = [...moves].filter((m) => m === 's' || m === 'f').length;
  const back = [...moves].filter((m) => m === 'b').length;
  if (!wrong && !back) return 'Clean run, every hop got closer.';
  const parts = [
    wrong ? times(wrong, 'one wrong turn', 'wrong turns') : '',
    back ? `stepped back ${times(back, 'once', 'times')}` : '',
  ].filter(Boolean);
  const line = parts.join(', ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
};

const formatTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

api.get('/init', async (c) => {
  const { username, puzzle } = await current();
  // The feed card and the game screen both load this; count which one it was.
  await count(puzzle.id, c.req.query('from') === 'card' ? 'views' : 'opens');
  const [players, leaders] = await Promise.all([playerCount(puzzle.id), leaderboard(puzzle.id, 0, 0)]);
  const best = leaders[0] ?? null;
  const subreddit = context.subredditName ?? '';
  if (!username) {
    return c.json<InitResponse>({
      username,
      puzzle,
      streak: 0,
      players,
      best,
      run: null,
      node: null,
      results: null,
      subreddit,
      following: false,
    });
  }
  const [run, streak, following] = await Promise.all([
    getRun(puzzle.id, username),
    getStreak(username),
    isFollowing(username),
  ]);
  const here = run?.status === 'playing' ? run.path[run.path.length - 1]! : null;
  return c.json<InitResponse>({
    username,
    puzzle,
    streak,
    players,
    best,
    run,
    node: here ? nodeView(puzzle, here) : null,
    results: run && run.status !== 'playing' ? await results(puzzle, username, run) : null,
    subreddit,
    following,
  });
});

api.post('/start', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to play', 401);
  const run = await startRun(puzzle, username);
  if (run.status !== 'playing') return fail(c, 'You already played this one');
  await stamp(username, puzzle.start, runTag(puzzle.id, run));
  return c.json<StartResponse>({ run, node: nodeView(puzzle, run.path[run.path.length - 1]!) });
});

api.post('/hop', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to play', 401);
  const { to } = await c.req.json<HopRequest>();
  const out = await hop(puzzle, username, String(to));
  if (!out.ok) return fail(c, out.error);
  const [newStamp] = await Promise.all([stamp(username, to, runTag(puzzle.id, out.run)), trackHop(c, puzzle, out.run)]);
  if (out.run.status === 'playing') {
    return c.json<HopResponse>({ status: 'playing', run: out.run, node: nodeView(puzzle, to), newStamp });
  }
  const streak = await getStreak(username);
  if (puzzle.number > 0) await updateStreakFlair(username, streak); // streaks are a daily thing
  return c.json<HopResponse>({ status: 'finished', results: await results(puzzle, username, out.run), streak });
});

api.post('/back', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to play', 401);
  const out = await stepBack(puzzle, username);
  if (!out.ok) return fail(c, out.error);
  return c.json<BackResponse>({ run: out.run, node: nodeView(puzzle, out.run.path[out.run.path.length - 1]!) });
});

api.post('/giveup', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to play', 401);
  const run = await giveUp(puzzle, username);
  if (!run) return fail(c, 'No run in progress');
  await trackGiveUp(c, run);
  return c.json<GiveUpResponse>({ results: await results(puzzle, username, run) });
});

api.get('/leaderboard', async (c) => {
  const { username, puzzle } = await current();
  const [rows, you] = await Promise.all([
    leaderboard(puzzle.id, 0, 49),
    username ? myRow(puzzle.id, username) : Promise.resolve(null),
  ]);
  return c.json<LeaderboardResponse>({ rows, you });
});

api.post('/share', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to share', 401);
  const run = await getRun(puzzle.id, username);
  if (!run || run.status !== 'finished') return fail(c, 'Finish the puzzle first');
  if (!context.postId) return fail(c, 'No post to comment on', 404);

  const [me, players, passport] = await Promise.all([
    myRow(puzzle.id, username),
    playerCount(puzzle.id),
    passportSummary(username, runTag(puzzle.id, run)),
  ]);
  const top = me && players > 1 ? ` · top ${Math.max(1, Math.ceil((me.rank / players) * 100))}%` : '';
  const label = (puzzle.number > 0 ? `Subhop No. ${puzzle.number}` : 'Subhop') + (puzzle.by ? ` (picked by u/${puzzle.by})` : '');
  const twist =
    puzzle.twist?.kind === 'avoid' ? ' · Border closed' : puzzle.twist?.kind === 'via' ? ' · Detour' : puzzle.twist?.kind === 'noback' ? ' · No return' : '';
  const fresh = passport.fresh.length;
  const stamps = fresh ? ` +${fresh} new ${fresh === 1 ? 'stamp' : 'stamps'}.` : '';
  // Three short lines. No route: it would spoil the puzzle for everyone else.
  const text =
    `**${label}** · r/${puzzle.start} → r/${puzzle.target}${twist}  \n` +
    `**${run.hops} hops** (par ${puzzle.par}) in ${formatTime((run.finishedAt ?? run.startedAt) - run.startedAt)}${top}  \n` +
    `${run.moves ? runStory(run.moves) : ''}${stamps}`.trim();

  let comment;
  try {
    comment = await reddit.submitComment({ id: context.postId, text, runAs: 'USER' });
  } catch (err) {
    console.warn('Comment as user failed, posting as app', err);
    comment = await reddit.submitComment({ id: context.postId, text: `u/${username} — ${text}`, runAs: 'APP' });
  }
  return c.json<ShareResponse>({ ok: true, commentUrl: comment?.permalink ? `https://reddit.com${comment.permalink}` : null });
});

api.post('/follow', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return fail(c, 'Log in to follow', 401);
  try {
    return c.json<FollowResponse>({ ok: true, subscribed: await follow(username) });
  } catch (error) {
    console.error('follow failed', error);
    return fail(c, 'Couldn’t follow right now');
  }
});

api.get('/passport', async (c) => {
  const username = await reddit.getCurrentUsername();
  return c.json<PassportResponse>({ collected: username ? await collectedSubs(username) : [], total: passportTotal() });
});

// ---- tomorrow's journey, picked by players ----
// You can propose and vote once you've finished or given up today's journey.
const hasPlayed = async (pid: string, username: string) => {
  const run = await getRun(pid, username);
  return run !== null && run.status !== 'playing';
};

api.get('/proposals', async (c) => {
  const { username, puzzle } = await current();
  const played = username ? await hasPlayed(puzzle.id, username) : false;
  return c.json<ProposalsResponse>(await listProposals(username, played));
});

api.post('/propose', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to propose', 401);
  if (!(await hasPlayed(puzzle.id, username))) return fail(c, 'Finish today’s journey first');
  const { start, target } = await c.req.json<ProposeRequest>();
  const out = await propose(username, String(start), String(target));
  if (!out.ok) return fail(c, out.error);
  return c.json<ProposalsResponse>(await listProposals(username, true));
});

api.post('/vote', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to vote', 401);
  if (!(await hasPlayed(puzzle.id, username))) return fail(c, 'Finish today’s journey first');
  const { key } = await c.req.json<VoteRequest>();
  const out = await vote(username, String(key));
  if (!out.ok) return fail(c, out.error);
  return c.json<ProposalsResponse>(await listProposals(username, true));
});

// Community icons for stamps. Only subs on today's map, at most 12 per call, cached server-side.
api.get('/icons', async (c) => {
  const { puzzle } = await current();
  const net = netFor(puzzle);
  const subs = [...new Set((c.req.query('subs') ?? '').split(','))].filter((s) => net.has(s)).slice(0, 12);
  return c.json<IconsResponse>({ icons: await icons(subs) });
});

// Live glimpse of the sub you're standing in. Only subs on today's map, cached server-side.
api.get('/peek', async (c) => {
  const { puzzle } = await current();
  const sub = c.req.query('sub') ?? '';
  if (!netFor(puzzle).has(sub)) return fail(c, 'Unknown community');
  return c.json<PeekResponse>({ peek: await peek(sub) });
});
