import type { Twist } from './api';

/*
 * A simulated player, used to judge how hard a puzzle is.
 *
 * It sees what a person sees: the names of the six exits, the district each one is in, and the
 * warmer/colder label after each hop. It never sees the map. It takes the destination if it is an
 * exit, otherwise heads for the destination's district (through that district's main community when
 * it is outside it), otherwise a hub, otherwise anything new. When a hop turns out colder it steps
 * back, which costs a hop, and doesn't try that exit again.
 *
 * This file has no imports that run, so scripts/build-puzzles.mjs can load it directly.
 */

export type Level = 'easy' | 'medium' | 'hard';
export const isLevel = (v: unknown): v is Level => v === 'easy' || v === 'medium' || v === 'hard';

export type BotWorld = {
  exits: (name: string) => string[];
  district: (name: string) => string;
};

export type BotPuzzle = { start: string; target: string; par: number; twist: Twist | null };

/** Fewest hops still needed after walking `path` (with the puzzle's twist applied). */
export type HopsLeft = (path: string[]) => number;

/** The main community of each district: the one the general hubs lead into. */
export const GATEWAY: Record<string, string> = {
  crafts: 'DIY',
  food: 'Cooking',
  home: 'gardening',
  world: 'travel',
  motors: 'cars',
  sports: 'sports',
  animals: 'aww',
  gaming: 'gaming',
  tech: 'technology',
  science: 'science',
  outdoors: 'Outdoors',
  fitness: 'Fitness',
  music: 'Music',
  screen: 'movies',
  arts: 'books',
  money: 'personalfinance',
};
const GATEWAYS = new Set(Object.values(GATEWAY));
const HUB_DISTRICT = 'lounge';

/** Deterministic random numbers (mulberry32), so a puzzle always gets the same rating. */
export const seeded = (seed: number): (() => number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const seedOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h;
};

export const BOT_CAP = 20;

/** One simulated run: the hops it took (step backs included), or null if it never arrived. */
export const botRun = (world: BotWorld, p: BotPuzzle, left: HopsLeft, rand: () => number): number | null => {
  const { twist } = p;
  const closed = twist?.kind === 'avoid' ? twist.sub : null;
  const via = twist?.kind === 'via' ? twist.sub : null;
  const canStepBack = twist?.kind !== 'noback';
  const pick = (list: string[]): string => list[Math.floor(rand() * list.length)] ?? p.target;

  const path = [p.start];
  const seen = new Set(path);
  let viaDone = via === null;
  let hops = 0;
  let before = left(path);
  while (hops < BOT_CAP) {
    const here = path[path.length - 1] ?? p.start;
    const goal = viaDone || via === null ? p.target : via;
    const goalDistrict = world.district(goal);
    const gateway = GATEWAY[goalDistrict];
    const open = world.exits(here).filter((e) => e !== closed && (viaDone || e !== p.target));
    if (!open.length) return null;
    const fresh = open.filter((e) => !seen.has(e));
    const opts = fresh.length ? fresh : open;
    const same = opts.filter((o) => world.district(o) === goalDistrict);
    const hubs = opts.filter((o) => world.district(o) === HUB_DISTRICT || GATEWAYS.has(o));
    let next: string;
    if (opts.includes(goal)) next = goal;
    else if (same.length) next = gateway && same.includes(gateway) && world.district(here) !== goalDistrict ? gateway : pick(same);
    else if (gateway && opts.includes(gateway)) next = gateway;
    else next = pick(hubs.length ? hubs : opts);

    path.push(next);
    seen.add(next);
    hops++;
    if (next === via) viaDone = true;
    if (next === p.target) return hops;
    const after = left(path);
    if (after > before && canStepBack && hops < BOT_CAP) {
      // Colder: step back and pay a hop for it.
      path.pop();
      hops++;
    } else {
      before = after;
    }
  }
  return null;
};

export type Rating = {
  near: number; // share of runs that arrived within par + 2
  over: number; // average hops over par (a run that never arrived counts as the cap)
};

export const BOT_TRIALS = 24;

export const ratePuzzle = (world: BotWorld, p: BotPuzzle, left: HopsLeft): Rating => {
  const rand = seeded(seedOf(`${p.start}>${p.target}>${p.twist ? JSON.stringify(p.twist) : ''}`));
  let near = 0;
  let over = 0;
  for (let i = 0; i < BOT_TRIALS; i++) {
    const h = botRun(world, p, left, rand);
    if (h !== null && h <= p.par + 2) near++;
    over += (h ?? BOT_CAP) - p.par;
  }
  return { near: near / BOT_TRIALS, over: over / BOT_TRIALS };
};

// Thresholds, on the average hops over par. Chosen from the spread of all candidate puzzles
// (printed by `npm run puzzles`).
export const TOO_EASY = 0.25;
export const EASY_MAX = 1;
export const MEDIUM_MAX = 2;
export const HARD_MAX = 3.25;
export const NEAR_MIN = 0.6;

/** Too easy to be a daily: the bot is at par, or one over, nearly every time. */
export const tooEasy = (r: Rating): boolean => r.over < TOO_EASY;

/** The difficulty label, or null when the puzzle is too hard to be fair. */
export const levelOf = (r: Rating): Level | null => {
  if (r.near < NEAR_MIN || r.over > HARD_MAX) return null;
  return r.over <= EASY_MAX ? 'easy' : r.over <= MEDIUM_MAX ? 'medium' : 'hard';
};
