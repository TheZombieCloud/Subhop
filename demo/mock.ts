/*
 * Local demo backend for recordings. Patches window.fetch so the real client
 * talks to an in-memory game instead of Devvit. Uses the same rules as the
 * server (src/shared/rules.ts); crowd stats, leaderboards and peeks are fake.
 *
 * Pick a scenario with ?s=<name>: daily | roadblock | detour | noreturn | home | homestart | proposed | played
 */
import type {
  Crowd,
  InitResponse,
  LeaderboardRow,
  NodeView,
  PathStat,
  Peek,
  Puzzle,
  Results,
  Run,
} from '../src/shared/api';
import { district } from '../src/shared/districts';
import { nodeNames, pathBetween, puzzlePool } from '../src/shared/graph';
import { buildPuzzle, checkProposal, homeNet, homePuzzle, hopsLeft, netFor, optimalRoute } from '../src/shared/rules';
import type { HomeConfig, TwistKind } from '../src/shared/rules';

const LATENCY_MS = 280;
const PLAYERS = 1284;
const ME = 'you';

// ---- scenario ----
const scenario = new URLSearchParams(location.search).get('s') ?? 'daily';

/** First pool puzzle where the twist fits and adds at most one hop, so recordings stay short. */
const DEMO_DAY = new Date().toISOString().slice(0, 10); // a real date, so the cover shows one

const withTwist = (kind: TwistKind): Puzzle => {
  for (let i = 0; i < 80; i++) {
    const base = puzzlePool[i];
    if (!base) break;
    const p = buildPuzzle({ id: DEMO_DAY, number: 9, ...base }, null, kind);
    if (p.twist && p.par <= base.par + 1) return p;
  }
  return buildPuzzle({ id: DEMO_DAY, number: 9, ...puzzlePool[0]! }, null, kind);
};

const HOME: HomeConfig = { sub: 'SubhopClub', onMap: false, mode: 'alternate', exits: ['knitting', 'boardgames', 'Coffee'] };

const makePuzzle = (): Puzzle => {
  switch (scenario) {
    case 'roadblock':
      return withTwist('avoid');
    case 'detour':
      return withTwist('via');
    case 'noreturn':
      return withTwist('noback');
    case 'home': {
      const hp = homePuzzle(HOME, 'end', 3);
      if (hp) return buildPuzzle({ id: DEMO_DAY, number: 9, ...hp }, HOME, null);
      break;
    }
    case 'homestart': {
      const hp = homePuzzle(HOME, 'start', 4);
      if (hp) return buildPuzzle({ id: DEMO_DAY, number: 10, ...hp }, HOME, null);
      break;
    }
    case 'proposed':
      return buildPuzzle({ id: DEMO_DAY, number: 11, ...puzzlePool[5]!, by: 'yarnover_yolanda' }, null, null);
  }
  return buildPuzzle({ id: DEMO_DAY, number: 7, ...puzzlePool[0]! }, null, null);
};

const puzzle = makePuzzle();
const net = netFor(puzzle);
const route = optimalRoute(net, puzzle.start, puzzle.target, puzzle.twist);
let run: Run | null =
  scenario === 'played'
    ? { status: 'finished', path: route, hops: route.length - 1, startedAt: Date.now() - 74_000, finishedAt: Date.now() }
    : null;
let streak = 4;

// The recorder reads this to know which exits to tap.
Object.assign(window, { __demo: { puzzle, route } });

// ---- fake but plausible crowd ----
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const NAMES = ['pitlane_pete', 'yarnover_yolanda', 'sourdough_sam', 'mapnerd42', 'quietcartographer', 'hopscotch_kid'];

const top3 = (): LeaderboardRow[] =>
  NAMES.slice(0, 3).map((username, i) => ({
    rank: i + 1,
    username,
    hops: puzzle.par,
    timeMs: 21_000 + i * 6_500,
    avatar: avatarFor(username),
  }));

// Fake avatars for some players; the rest show the initial fallback.
// Shaped like real Snoovatars: a tall transparent cutout of a full-body figure.
const avatarFor = (username: string): string | null => {
  if (hash(username) % 2 === 0) return null;
  const c = ['#ff6b3d', '#3d8bff', '#29a36a', '#a05cff'][hash(username) % 4]!;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 600">` +
    `<line x1="190" y1="40" x2="230" y2="10" stroke="#333" stroke-width="6"/><circle cx="232" cy="10" r="10" fill="${c}"/>` +
    `<ellipse cx="190" cy="120" rx="95" ry="75" fill="#fff" stroke="#333" stroke-width="6"/>` +
    `<circle cx="160" cy="115" r="12" fill="${c}"/><circle cx="220" cy="115" r="12" fill="${c}"/>` +
    `<rect x="115" y="200" width="150" height="230" rx="60" fill="${c}" stroke="#333" stroke-width="6"/>` +
    `<rect x="130" y="420" width="45" height="150" rx="20" fill="#444"/><rect x="205" y="420" width="45" height="150" rx="20" fill="#444"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const nodeView = (name: string): NodeView => ({ name, description: net.describe(name), exits: net.exits(name) });

const rankFor = (r: Run) => (r.status !== 'finished' ? null : 40 + (r.hops - puzzle.par) * 260 + 17);

const crowdFor = (r: Run): Crowd => {
  const exits = net.exits(puzzle.start);
  const firstTotal = PLAYERS + 151;
  const weights = exits.map((e, i) => (e === route[1] ? 31 : [24, 17, 12, 9, 7, 5][i] ?? 4));
  const sum = weights.reduce((a, b) => a + b, 0);
  const firstMoves = exits
    .map((name, i) => ({ name, count: Math.round((weights[i]! / sum) * firstTotal) }))
    .sort((a, b) => b.count - a.count);
  const shares = [0.27, 0.34, 0.2, 0.12, 0.07];
  const hopCounts = shares.map((sh, i) => ({ hops: puzzle.par + i, count: Math.round(sh * PLAYERS) }));
  const rank = rankFor(r);
  return {
    finishers: PLAYERS,
    hopCounts,
    firstMoves,
    firstTotal,
    hubs: route.slice(1, -1).map((name, i) => ({ name, count: Math.round(PLAYERS * (0.61 - i * 0.2)) })),
    sameRoute: r.status === 'finished' ? (r.path.join('>') === route.join('>') ? 311 : 0) : null,
    topPct: rank ? Math.max(1, Math.ceil((rank / PLAYERS) * 100)) : null,
  };
};

const weirdRoute = (): PathStat | null => {
  const exits = net.exits(puzzle.start);
  const detourVia = exits[exits.length - 1];
  if (!detourVia) return null;
  const rest = pathBetween(net.exits, detourVia, puzzle.target);
  return rest.length ? { path: [puzzle.start, ...rest], hops: rest.length, count: 1 } : null;
};

// Passport: a returning player who already has some stamps (including today's start).
// Nothing next to the start is stamped yet, so the first hop always shows the "New stamp" moment.
const STAMPED_BEFORE = new Set([
  puzzle.start,
  ...nodeNames().filter((n) => hash(n) % 5 === 0 && !net.exits(puzzle.start).includes(n)),
]);
const PASSPORT_BEFORE = STAMPED_BEFORE.size;
const freshStamps: string[] = [];

const resultsFor = (r: Run): Results => ({
  run: r,
  timeMs: (r.finishedAt ?? Date.now()) - r.startedAt,
  rank: rankFor(r),
  myAvatar: null,
  rival: r.status === 'finished' ? { rank: 576, username: 'mapnerd42', hops: r.hops - 1, timeMs: 61_000, avatar: null } : null,
  passport: { collected: PASSPORT_BEFORE + freshStamps.length, total: nodeNames().length, fresh: freshStamps },
  players: PLAYERS,
  top: top3(),
  mostCommon: { path: route, hops: route.length - 1, count: 312 },
  weirdest: weirdRoute(),
  optimal: route,
  crowd: crowdFor(r),
});

const PEEK_TITLES: Record<string, string> = {
  crafts: 'Finally finished my first sweater after 8 months',
  food: 'Third attempt at croissants and I think I finally nailed the lamination',
  home: 'Before and after: turned a dingy box room into a reading nook',
  world: 'What’s a small thing from your country that visitors never expect?',
  motors: 'That last-lap overtake deserves its own documentary',
  sports: 'Post-match thread: what a comeback',
  animals: 'He has learned to open the treat drawer. We are no longer in charge.',
  lounge: 'What’s a skill that took you embarrassingly long to learn?',
  gaming: '400 hours in and I just found a secret area by accident',
  tech: 'I automated my entire morning routine and now I don’t know what to do with myself',
  science: 'New image just dropped and it’s absolutely stunning',
  outdoors: 'Woke up above the clouds after a 14-mile day',
  fitness: 'One year of showing up: progress update',
  music: 'Album of the year conversation starts now',
  screen: 'Rewatched the whole series and noticed something in episode one',
  arts: 'Finished my first oil painting. Be gentle.',
  money: 'Hit my emergency fund goal today',
  homebase: 'Welcome thread: introduce yourself!',
};

const peekFor = (sub: string): Peek => {
  const h = hash(sub);
  const members = 40_000 + (h % 9_000_000);
  return {
    name: sub,
    members,
    online: Math.round(members / (300 + (h % 400))),
    top: { title: PEEK_TITLES[district(sub).id] ?? 'Weekly discussion thread', score: 1_200 + (h % 40_000), comments: 80 + (h % 2_000) },
  };
};

// Stand-in community icons (real ones come from Reddit). Two out of three subs get one,
// so recordings show both the icon print and the name fallback.
const ICON_SHAPES = [
  '<circle cx="50" cy="50" r="22" fill="none" stroke="#fff" stroke-width="9"/>',
  '<path d="M28 70 50 26 72 70z" fill="#fff"/>',
  '<rect x="30" y="30" width="40" height="40" rx="6" fill="#fff"/>',
  '<path d="M50 24 57 43 77 43 61 55 67 75 50 63 33 75 39 55 23 43 43 43z" fill="#fff"/>',
];
const ICON_BG = ['#ff4500', '#0079d3', '#46d160', '#ffb000', '#7193ff', '#222222', '#f5f5f5'];
const iconFor = (sub: string): string | null => {
  const h = hash(sub);
  if (h % 3 === 0) return null;
  const bg = ICON_BG[h % ICON_BG.length]!;
  const shape = ICON_SHAPES[(h >> 3) % ICON_SHAPES.length]!.replace(/#fff/g, bg === '#f5f5f5' ? '#222' : '#fff');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>${shape}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

// ---- tomorrow's proposals (home scenarios: tomorrow starts at home) ----
const TOMORROW_SIDE = scenario.startsWith('home') ? ('start' as const) : null;
const tomorrowNet = homeNet(TOMORROW_SIDE ? HOME : null, TOMORROW_SIDE);
const tomorrowHome = TOMORROW_SIDE ? HOME.sub : null;
type MockProp = { start: string; target: string; votes: number; by: string };
const seedProps = (): MockProp[] => {
  const wanted: [string, string, number, string][] = TOMORROW_SIDE
    ? [[HOME.sub, 'formula1', 41, 'mapnerd42'], [HOME.sub, 'aww', 18, 'quietcartographer'], [HOME.sub, 'space', 9, 'sourdough_sam']]
    : [['cats', 'formula1', 41, 'mapnerd42'], ['Coffee', 'nba', 18, 'quietcartographer'], ['gardening', 'pcmasterrace', 9, 'sourdough_sam']];
  return wanted
    .filter(([s, t]) => checkProposal(tomorrowNet, s, t, tomorrowHome, TOMORROW_SIDE).ok)
    .map(([start, target, votes, by]) => ({ start, target, votes, by }));
};
const props = seedProps();
let myVote: string | null = null;
let myProposal: string | null = null;
const propKey = (p: { start: string; target: string }) => `${p.start}>${p.target}`;
const proposalsView = () => ({
  day: '2026-11-14',
  number: 3,
  home: tomorrowHome,
  homeSide: TOMORROW_SIDE,
  homeExits: TOMORROW_SIDE ? HOME.exits : [],
  items: [...props]
    .sort((a, b) => b.votes - a.votes)
    .map((p) => {
      const c = checkProposal(tomorrowNet, p.start, p.target, tomorrowHome, TOMORROW_SIDE);
      return { key: propKey(p), start: p.start, target: p.target, hops: c.ok ? c.hops : 0, votes: p.votes, by: p.by };
    }),
  myVote,
  myProposal,
  canPropose: run !== null && run.status !== 'playing',
});
const castVote = (key: string) => {
  if (myVote === key) return;
  const prev = props.find((p) => propKey(p) === myVote);
  if (prev) prev.votes -= 1;
  const next = props.find((p) => propKey(p) === key);
  if (next) next.votes += 1;
  myVote = key;
};

// ---- endpoints ----
type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const err = (message: string): Reply => ({ status: 400, body: { status: 'error', message } });

const handle = (path: string, body: Record<string, unknown>): Reply => {
  const [name, query = ''] = path.split('?');
  const here = run ? run.path[run.path.length - 1]! : puzzle.start;
  if (name?.startsWith('telemetry/')) {
    const receipt = { status: 'JOURNEY_RECEIPT_DENIED_PLAYTEST', message: 'demo' };
    return ok(name.endsWith('/start') ? { journeyId: `demo-${Date.now()}`, receipt } : { receipt });
  }
  switch (name) {
    case 'init': {
      const res: InitResponse = {
        username: ME,
        puzzle,
        streak,
        players: PLAYERS,
        best: top3()[0] ?? null,
        run,
        node: run?.status === 'playing' ? nodeView(here) : null,
        results: run && run.status !== 'playing' ? resultsFor(run) : null,
        subreddit: 'subhopgame',
        following: false,
      };
      return ok(res);
    }
    case 'passport':
      return ok({ collected: [...STAMPED_BEFORE, ...freshStamps], total: nodeNames().length });
    case 'follow':
      return ok({ ok: true, subscribed: true });
    case 'start':
      run ??= { status: 'playing', path: [puzzle.start], hops: 0, startedAt: Date.now() };
      return ok({ run, node: nodeView(here) });
    case 'hop': {
      const to = String(body.to);
      if (!run || run.status !== 'playing') return err('No run in progress');
      if (!net.exits(here).includes(to)) return err(`r/${to} isn't an exit from r/${here}`);
      const t = puzzle.twist;
      if (t?.kind === 'avoid' && to === t.sub) return err(`r/${to} is closed today`);
      if (t?.kind === 'via' && to === puzzle.target && !run.path.includes(t.sub)) return err(`Pass through r/${t.sub} first`);
      const closer = hopsLeft(puzzle, [...run.path, to]) < hopsLeft(puzzle, run.path);
      run = { ...run, path: [...run.path, to], hops: run.hops + 1, moves: (run.moves ?? '') + (closer ? 'c' : 's') };
      const newStamp = !STAMPED_BEFORE.has(to) && !freshStamps.includes(to);
      if (newStamp) freshStamps.push(to);
      if (to !== puzzle.target) return ok({ status: 'playing', run, node: nodeView(to), newStamp });
      run = { ...run, status: 'finished', finishedAt: Date.now() };
      streak += 1;
      return ok({ status: 'finished', results: resultsFor(run), streak });
    }
    case 'back': {
      if (!run || run.status !== 'playing' || run.path.length < 2) return err('Already at the start');
      if (puzzle.twist?.kind === 'noback') return err('No stepping back today');
      const path = run.path.slice(0, -1);
      run = { ...run, path, hops: run.hops + 1, moves: (run.moves ?? '') + 'b' };
      return ok({ run, node: nodeView(path[path.length - 1]!) });
    }
    case 'giveup':
      if (!run) return err('No run in progress');
      run = { ...run, status: 'gaveup', finishedAt: Date.now() };
      return ok({ results: resultsFor(run) });
    case 'leaderboard': {
      const rows: LeaderboardRow[] = [
        ...top3(),
        ...NAMES.slice(3).map((username, i) => ({
          rank: i + 4,
          username,
          hops: puzzle.par,
          timeMs: 44_000 + i * 3_100,
          avatar: avatarFor(username),
        })),
      ];
      const rank = run ? rankFor(run) : null;
      const you =
        run && rank
          ? { rank, username: ME, hops: run.hops, timeMs: (run.finishedAt ?? 0) - run.startedAt, avatar: null }
          : null;
      return ok({ rows, you });
    }
    case 'share':
      return ok({ ok: true, commentUrl: null });
    case 'peek':
      return ok({ peek: peekFor(new URLSearchParams(query).get('sub') ?? '') });
    case 'proposals':
      return ok(proposalsView());
    case 'propose': {
      if (myProposal) return err('You already proposed one for tomorrow');
      const start = String(body.start);
      const target = String(body.target);
      const c = checkProposal(tomorrowNet, start, target, tomorrowHome, TOMORROW_SIDE);
      if (!c.ok) return err(c.reason);
      const key = `${start}>${target}`;
      if (!props.some((p) => propKey(p) === key)) props.push({ start, target, votes: 0, by: ME });
      myProposal = key;
      castVote(key);
      return ok(proposalsView());
    }
    case 'vote':
      castVote(String(body.key));
      return ok(proposalsView());
    case 'icons': {
      const subs = (new URLSearchParams(query).get('subs') ?? '').split(',');
      return ok({ icons: Object.fromEntries(subs.map((s) => [s, iconFor(s)])) });
    }
  }
  return err(`Unknown endpoint ${name}`);
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const at = url.indexOf('/api/');
  if (at < 0) return realFetch(input, init);
  const raw = typeof init?.body === 'string' ? init.body : '{}';
  const parsed: unknown = JSON.parse(raw);
  const body: Record<string, unknown> = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const reply = handle(url.slice(at + 5), body);
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
};

// ---- Devvit effects (toasts) shown as an overlay, since there's no Reddit around the post ----
window.addEventListener('message', (e: MessageEvent<unknown>) => {
  const d = e.data;
  if (typeof d !== 'object' || d === null || !('showToast' in d)) return;
  const st = d.showToast;
  const text =
    typeof st === 'object' && st !== null && 'toast' in st && typeof st.toast === 'object' && st.toast !== null && 'text' in st.toast
      ? String(st.toast.text)
      : '';
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'demo-toast';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
});
