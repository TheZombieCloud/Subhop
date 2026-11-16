import { redis } from '@devvit/web/server';
import type { HomeSide, Proposal, ProposalsResponse } from '../../shared/api';
import { dailyNumber, dayAfter, todayId } from './days';
import { activeHome, checkProposal, homeNet, homeSideFor } from './net';
import type { HomeConfig } from './net';

/*
 * Players propose tomorrow's daily journey and vote on each other's proposals.
 * Keys are per target day (the daily the proposals compete for):
 *
 *   props:{day}       zset   "start>target" -> votes
 *   propby:{day}      hash   "start>target" -> username of the first proposer
 *   propvote:{day}    hash   username -> the key they voted for (one vote each, can switch)
 *   propmine:{day}    hash   username -> the key they proposed (one proposal each)
 */

const SHOWN = 6;
const EXPIRE_S = 3 * 24 * 60 * 60;

const keyOf = (start: string, target: string) => `${start}>${target}`;
const split = (key: string): [string, string] | null => {
  const [a, b] = key.split('>');
  return a && b ? [a, b] : null;
};

/** Tomorrow's daily: its id, number, and where the home community sits (if anywhere). */
const tomorrow = async () => {
  const day = dayAfter(todayId());
  const number = await dailyNumber(day);
  const home = await activeHome();
  const side = home ? homeSideFor(home.mode, number) : null;
  return { day, number, home, side, net: homeNet(home, side) };
};

const touch = async (day: string) => {
  for (const k of ['props', 'propby', 'propvote', 'propmine']) await redis.expire(`${k}:${day}`, EXPIRE_S);
};

export const listProposals = async (user: string | null, canPropose: boolean): Promise<ProposalsResponse> => {
  const t = await tomorrow();
  const rows = await redis.zRange(`props:${t.day}`, 0, SHOWN - 1, { by: 'rank', reverse: true });
  const [myVote, myProposal] = user
    ? await Promise.all([redis.hGet(`propvote:${t.day}`, user), redis.hGet(`propmine:${t.day}`, user)])
    : [undefined, undefined];
  // Your own proposal and your vote always show, even when they're outside the top few.
  for (const key of [myProposal, myVote]) {
    if (!key || rows.some((r) => r.member === key)) continue;
    const score = await redis.zScore(`props:${t.day}`, key);
    if (score !== undefined && score !== null) rows.push({ member: key, score });
  }
  const by = rows.length ? await redis.hMGet(`propby:${t.day}`, rows.map((r) => r.member)) : [];
  const items: Proposal[] = [];
  rows.forEach((r, i) => {
    const ends = split(r.member);
    if (!ends) return;
    const check = checkProposal(t.net, ends[0], ends[1], t.home?.sub ?? null, t.side);
    if (!check.ok) return; // config changed since it was proposed
    items.push({ key: r.member, start: ends[0], target: ends[1], hops: check.hops, votes: r.score, by: by[i] ?? '' });
  });
  return {
    day: t.day,
    number: t.number,
    home: t.side ? (t.home?.sub ?? null) : null,
    homeSide: t.side,
    homeExits: t.side ? (t.home?.exits ?? []) : [],
    items,
    myVote: myVote ?? null,
    myProposal: myProposal ?? null,
    canPropose,
  };
};

export const vote = async (user: string, key: string): Promise<{ ok: true } | { ok: false; error: string }> => {
  const t = await tomorrow();
  const exists = await redis.zScore(`props:${t.day}`, key);
  if (exists === undefined || exists === null) return { ok: false, error: 'That proposal is gone' };
  const prev = await redis.hGet(`propvote:${t.day}`, user);
  if (prev === key) return { ok: true };
  if (prev) await redis.zIncrBy(`props:${t.day}`, prev, -1);
  await redis.zIncrBy(`props:${t.day}`, key, 1);
  await redis.hSet(`propvote:${t.day}`, { [user]: key });
  await touch(t.day);
  return { ok: true };
};

export const propose = async (
  user: string,
  start: string,
  target: string
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const t = await tomorrow();
  if (await redis.hGet(`propmine:${t.day}`, user)) return { ok: false, error: 'You already proposed one for tomorrow' };
  const check = checkProposal(t.net, start, target, t.home?.sub ?? null, t.side);
  if (!check.ok) return { ok: false, error: check.reason };
  const key = keyOf(start, target);
  const existing = await redis.zScore(`props:${t.day}`, key);
  if (existing === undefined || existing === null) {
    await redis.zAdd(`props:${t.day}`, { member: key, score: 0 });
    await redis.hSet(`propby:${t.day}`, { [key]: user });
  }
  await redis.hSet(`propmine:${t.day}`, { [user]: key });
  return vote(user, key); // proposing counts as your vote
};

/** Testing aid: take back a user's vote and proposal for tomorrow (the proposal stays listed). */
export const resetProposalsFor = async (user: string): Promise<void> => {
  const t = await tomorrow();
  const voted = await redis.hGet(`propvote:${t.day}`, user);
  if (voted) await redis.zIncrBy(`props:${t.day}`, voted, -1);
  await redis.hDel(`propvote:${t.day}`, [user]);
  await redis.hDel(`propmine:${t.day}`, [user]);
};

/**
 * The most-voted valid proposal for this daily, if any. Re-checked against the
 * day's home setup in case mods changed it after people voted.
 */
export const winningProposal = async (
  day: string,
  home: HomeConfig | null,
  side: HomeSide | null
): Promise<{ start: string; target: string; par: number; by: string } | null> => {
  const rows = await redis.zRange(`props:${day}`, 0, 9, { by: 'rank', reverse: true });
  const net = homeNet(home, side);
  for (const r of rows) {
    if (r.score < 1) continue;
    const ends = split(r.member);
    if (!ends) continue;
    const check = checkProposal(net, ends[0], ends[1], side ? (home?.sub ?? null) : null, side);
    if (!check.ok) continue;
    const by = (await redis.hGet(`propby:${day}`, r.member)) ?? '';
    return { start: ends[0], target: ends[1], par: check.hops, by };
  }
  return null;
};
