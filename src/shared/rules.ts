import type { HomeSide, Puzzle, Twist } from './api';
import { describe, distances, exitsOf, hasNode, nodeNames, pathBetween } from './graph';

/*
 * Pure game rules shared by the server, the client and the local demo harness:
 * the map a puzzle is played on, home puzzles, player proposals, twists and par.
 * The map is the built-in graph, plus (for "home" puzzles in a community that
 * isn't on the graph) the host sub wired in via the subs its mods picked.
 */

export type Net = {
  exits: (name: string) => string[];
  has: (name: string) => boolean;
  describe: (name: string) => string;
};

export const BASE_NET: Net = { exits: exitsOf, has: hasNode, describe };

type NetInput = Pick<Puzzle, 'start' | 'target' | 'home' | 'homeExits'>;

export const netFor = (p: NetInput): Net => {
  if (!p.home || !p.homeExits.length) return BASE_NET;
  const home = p.home === 'start' ? p.start : p.target;
  const inbound = new Set(p.homeExits);
  const note = p.home === 'start' ? 'Home. Today’s journey starts here.' : 'Home. This is where today’s journey ends.';
  return {
    exits: (n) => (n === home ? p.homeExits : inbound.has(n) ? [...exitsOf(n), home] : exitsOf(n)),
    has: (n) => n === home || hasNode(n),
    describe: (n) => (n === home ? note : describe(n)),
  };
};

export const MIN_HOME_EXITS = 2;
export const MAX_HOME_EXITS = 6;

/** Where the host community sits in daily journeys. */
export type HomeMode = 'off' | 'end' | 'start' | 'alternate';
export const HOME_MODES: { value: HomeMode; label: string }[] = [
  { value: 'off', label: 'Off: use the global map' },
  { value: 'end', label: 'Journeys end here' },
  { value: 'start', label: 'Journeys start here' },
  { value: 'alternate', label: 'Alternate: end one day, start the next' },
];
export const isHomeMode = (v: unknown): v is HomeMode => HOME_MODES.some((m) => m.value === v);

export type HomeConfig = { sub: string; onMap: boolean; mode: HomeMode; exits: string[] };

/** Which end is home on daily #n ("alternate" flips every day). */
export const homeSideFor = (mode: HomeMode, n: number): HomeSide | null =>
  mode === 'off' ? null : mode === 'alternate' ? (n % 2 === 0 ? 'start' : 'end') : mode;

/** The map for a day whose home sits on `side` (or the base map when there's no home). */
export const homeNet = (home: HomeConfig | null, side: HomeSide | null): Net =>
  home && side ? netFor({ start: home.sub, target: home.sub, home: side, homeExits: home.exits }) : BASE_NET;

export const parseExits = (raw: string | undefined): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && hasNode(x)) : [];
  } catch {
    return [];
  }
};

// Spreads consecutive days across the candidate list without repeats close together.
const pick = <T>(items: T[], n: number): T | undefined =>
  items.length ? items[(((n * 7919) % items.length) + items.length) % items.length] : undefined;

/** The other end of a home journey, 3–4 hops away (2–5 if the map doesn't allow it). */
export const homePuzzle = (
  home: HomeConfig,
  side: HomeSide,
  n: number
): { start: string; target: string; par: number } | null => {
  const net = homeNet(home, side);
  const near = new Set([home.sub, ...home.exits, ...net.exits(home.sub)]);
  const others = nodeNames()
    .filter((s) => !near.has(s) && !net.exits(s).includes(home.sub))
    .sort();
  const fromHome = side === 'start' ? distances(net.exits, home.sub) : null;
  const scored = others.map((s) => ({ s, d: fromHome ? fromHome.get(s) : distances(net.exits, s).get(home.sub) }));
  const within = (lo: number, hi: number) =>
    scored.filter((x): x is { s: string; d: number } => x.d !== undefined && x.d >= lo && x.d <= hi);
  const chosen = pick(within(3, 4), n) ?? pick(within(2, 5), n);
  if (!chosen) return null;
  return side === 'start'
    ? { start: home.sub, target: chosen.s, par: chosen.d }
    : { start: chosen.s, target: home.sub, par: chosen.d };
};

// ---- player proposals ----
export const PROPOSAL_MIN_HOPS = 3;
export const PROPOSAL_MAX_HOPS = 5;

export type ProposalCheck = { ok: true; hops: number } | { ok: false; reason: string };

/** Whether start → target makes a fair daily on this map (and respects a fixed home end). */
export const checkProposal = (
  net: Net,
  start: string,
  target: string,
  home: string | null,
  side: HomeSide | null
): ProposalCheck => {
  if (!net.has(start) || !net.has(target)) return { ok: false, reason: 'Pick two communities on the map' };
  if (start === target) return { ok: false, reason: 'Start and destination must differ' };
  if (home && side === 'start' && start !== home) return { ok: false, reason: `Tomorrow starts at r/${home}` };
  if (home && side === 'end' && target !== home) return { ok: false, reason: `Tomorrow ends at r/${home}` };
  const route = pathBetween(net.exits, start, target);
  if (!route.length) return { ok: false, reason: 'No route between those two' };
  const hops = route.length - 1;
  if (hops < PROPOSAL_MIN_HOPS) return { ok: false, reason: `Too close: ${hops} ${hops === 1 ? 'hop' : 'hops'}` };
  if (hops > PROPOSAL_MAX_HOPS) return { ok: false, reason: `Too far: ${hops} hops` };
  return { ok: true, hops };
};

// ---- twists ----
export type TwistKind = Twist['kind'];

/** Twist days (UTC): Roadblock Wednesday, Detour Friday, No-Return Sunday. */
export const twistKindFor = (pid: string): TwistKind | null => {
  const day = new Date(`${pid}T00:00:00Z`).getUTCDay();
  return day === 3 ? 'avoid' : day === 5 ? 'via' : day === 0 ? 'noback' : null;
};

/** The best route under a puzzle's twist; [] if impossible. */
export const optimalRoute = (net: Net, start: string, target: string, twist: Twist | null): string[] => {
  if (twist?.kind === 'avoid') return pathBetween(net.exits, start, target, new Set([twist.sub]));
  if (twist?.kind === 'via') {
    const leg1 = pathBetween(net.exits, start, twist.sub, new Set([target]));
    const leg2 = pathBetween(net.exits, twist.sub, target);
    return leg1.length && leg2.length ? [...leg1, ...leg2.slice(1)] : [];
  }
  return pathBetween(net.exits, start, target);
};

/** Fewest hops from where `path` ends to the target, under the puzzle's twist (par if unreachable). */
export const hopsLeft = (p: NetInput & Pick<Puzzle, 'twist' | 'par'>, path: string[]): number => {
  const here = path[path.length - 1] ?? p.start;
  const twist = p.twist?.kind === 'via' && path.includes(p.twist.sub) ? null : p.twist;
  const route = optimalRoute(netFor(p), here, p.target, twist);
  return route.length ? route.length - 1 : p.par;
};

/** Choose a twist that actually changes the puzzle, and the new par. */
export const planTwist = (
  net: Net,
  start: string,
  target: string,
  kind: TwistKind,
  n: number
): { twist: Twist; par: number } | null => {
  const base = pathBetween(net.exits, start, target);
  if (!base.length) return null;
  const par = base.length - 1;

  if (kind === 'noback') return { twist: { kind }, par };

  if (kind === 'avoid') {
    // Close a sub on the obvious route, as long as the detour costs at most 2 extra hops.
    const options = base
      .slice(1, -1)
      .map((sub) => ({ sub, route: optimalRoute(net, start, target, { kind: 'avoid', sub }) }))
      .filter((o) => o.route.length && o.route.length - 1 <= par + 2);
    const o = pick(options, n);
    return o ? { twist: { kind: 'avoid', sub: o.sub }, par: o.route.length - 1 } : null;
  }

  // Detour: a sub off the obvious route that adds 1–2 hops.
  const onBase = new Set(base);
  const options = nodeNames()
    .filter((sub) => !onBase.has(sub) && net.has(sub))
    .sort()
    .map((sub) => ({ sub, route: optimalRoute(net, start, target, { kind: 'via', sub }) }))
    .filter((o) => o.route.length && o.route.length - 1 >= par + 1 && o.route.length - 1 <= par + 2);
  const o = pick(options, n);
  return o ? { twist: { kind: 'via', sub: o.sub }, par: o.route.length - 1 } : null;
};

/** Wraps a start/target into a full puzzle, applying a twist if one fits. */
export const buildPuzzle = (
  base: { id: string; number: number; start: string; target: string; par: number; by?: string | null },
  home: HomeConfig | null,
  kind: TwistKind | null
): Puzzle => {
  const side: HomeSide | null = !home ? null : base.target === home.sub ? 'end' : base.start === home.sub ? 'start' : null;
  const puzzle: Puzzle = {
    id: base.id,
    number: base.number,
    start: base.start,
    target: base.target,
    par: base.par,
    by: base.by ?? null,
    twist: null,
    home: side,
    homeExits: home && side ? home.exits : [],
  };
  if (!kind) return puzzle;
  const plan = planTwist(netFor(puzzle), puzzle.start, puzzle.target, kind, Math.abs(base.number) + base.start.length);
  return plan ? { ...puzzle, twist: plan.twist, par: plan.par } : puzzle;
};

export const parseTwist = (raw: string | undefined): Twist | null => {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || !('kind' in v)) return null;
    if (v.kind === 'noback') return { kind: 'noback' };
    if ((v.kind === 'avoid' || v.kind === 'via') && 'sub' in v && typeof v.sub === 'string') {
      return { kind: v.kind, sub: v.sub };
    }
    return null;
  } catch {
    return null;
  }
};
