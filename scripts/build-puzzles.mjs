// Validates src/shared/graph.json and generates src/shared/puzzles.json.
// Run: npm run puzzles
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const graphPath = join(root, 'src/shared/graph.json');
const outPath = join(root, 'src/shared/puzzles.json');

const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const names = Object.keys(graph);
const errors = [];

// ---- validation ----
const lower = new Map();
for (const n of names) {
  if (lower.has(n.toLowerCase())) errors.push(`duplicate (case-insensitive): ${n}`);
  lower.set(n.toLowerCase(), n);
}
const inDeg = Object.fromEntries(names.map((n) => [n, 0]));
for (const [n, [desc, exits]] of Object.entries(graph)) {
  if (!desc) errors.push(`${n}: missing description`);
  if (exits.length !== 6) errors.push(`${n}: has ${exits.length} exits (want 6)`);
  if (new Set(exits).size !== exits.length) errors.push(`${n}: duplicate exits`);
  for (const e of exits) {
    if (e === n) errors.push(`${n}: links to itself`);
    if (!(e in graph)) errors.push(`${n} -> ${e}: unknown subreddit`);
    else inDeg[e]++;
  }
}
for (const [n, d] of Object.entries(inDeg)) if (d === 0) errors.push(`${n}: unreachable (in-degree 0)`);

// Every sub must sit in exactly one themed district (src/shared/districts.json).
const districts = JSON.parse(readFileSync(join(root, 'src/shared/districts.json'), 'utf8'));
const districtOf = new Map();
for (const [id, subs] of Object.entries(districts)) {
  for (const sub of subs) {
    if (!(sub in graph)) errors.push(`districts.${id}: unknown subreddit ${sub}`);
    if (districtOf.has(sub)) errors.push(`${sub}: in both ${districtOf.get(sub)} and ${id}`);
    districtOf.set(sub, id);
  }
}
for (const n of names) if (!districtOf.has(n)) errors.push(`${n}: not in any district`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

// ---- BFS from every node ----
const bfs = (start) => {
  const dist = { [start]: 0 };
  const ways = { [start]: 1 }; // number of distinct shortest paths
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    for (const nx of graph[cur][1]) {
      if (!(nx in dist)) {
        dist[nx] = dist[cur] + 1;
        ways[nx] = 0;
        q.push(nx);
      }
      if (dist[nx] === dist[cur] + 1) ways[nx] += ways[cur];
    }
  }
  return { dist, ways };
};

let unreachablePairs = 0;
let maxPar = 0;
const candidates = [];
for (const s of names) {
  const { dist, ways } = bfs(s);
  for (const t of names) {
    if (t === s) continue;
    if (!(t in dist)) {
      unreachablePairs++;
      continue;
    }
    maxPar = Math.max(maxPar, dist[t]);
    // Good puzzles: par 3-4, few optimal routes (there's a "trick" to find), target reachable many ways.
    // The general hubs (lounge) are for passing through, like airports: never a start or a destination.
    if (districtOf.get(s) === 'lounge' || districtOf.get(t) === 'lounge') continue;
    if (dist[t] >= 3 && dist[t] <= 4 && ways[t] <= 4 && inDeg[t] >= 4) {
      candidates.push({ start: s, target: t, par: dist[t], routes: ways[t] });
    }
  }
}

// deterministic random (mulberry32)
let seed = 0x5ab40b;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- difficulty: how does a simulated player do? ----
// The bot lives in src/shared/bot.ts (the server uses the same one for twists and player proposals).
// It sees exit names, their districts and the warmer/colder label, never the map. Each candidate is
// rated by how many hops over par the bot takes on average. Puzzles it nearly always solves at par
// are dropped as too easy, puzzles it gets lost on are dropped as too hard, and the rest are split
// into easy, medium and hard.
const { ratePuzzle, levelOf, tooEasy } = await import(pathToFileURL(join(root, 'src/shared/bot.ts')).href);
const world = { exits: (n) => graph[n][1], district: (n) => districtOf.get(n) };
const toTarget = new Map(); // target -> { node: hops to target }
for (const s of names) {
  const { dist } = bfs(s);
  for (const [t, d] of Object.entries(dist)) {
    if (!toTarget.has(t)) toTarget.set(t, {});
    toTarget.get(t)[s] = d;
  }
}
const rate = (c) => {
  const d = toTarget.get(c.target);
  return ratePuzzle(world, { start: c.start, target: c.target, par: c.par, twist: null }, (path) => d[path[path.length - 1]]);
};
const before = candidates.length;
const ratings = new Map(candidates.map((c) => [c, rate(c)]));
const spread = {};
for (const r of ratings.values()) {
  const k = (Math.floor(r.over * 2) / 2).toFixed(1);
  spread[k] = (spread[k] ?? 0) + 1;
}
const easyOut = candidates.filter((c) => tooEasy(ratings.get(c))).length;
const hardOut = candidates.filter((c) => levelOf(ratings.get(c)) === null).length;
candidates.splice(0, candidates.length, ...candidates.filter((c) => !tooEasy(ratings.get(c)) && levelOf(ratings.get(c))));
for (let i = candidates.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}

// Up to 250 per level, never repeating a start or target within 10 puzzles of the same level.
const PER_LEVEL = 250;
const pool = [];
const kept = { easy: 0, medium: 0, hard: 0 };
for (const level of ['easy', 'medium', 'hard']) {
  const recent = [];
  for (const c of candidates) {
    if (levelOf(ratings.get(c)) !== level) continue;
    if (recent.some((r) => r.start === c.start || r.target === c.target || r.start === c.target)) continue;
    pool.push({ start: c.start, target: c.target, par: c.par, level });
    recent.push(c);
    if (recent.length > 10) recent.shift();
    if (++kept[level] >= PER_LEVEL) break;
  }
}

// Puzzle #1 is the showcase.
const showcase = { start: 'batman', target: 'knitting', par: bfs('batman').dist.knitting };
const showcaseRating = rate(showcase);
showcase.level = levelOf(showcaseRating) ?? 'easy';
const puzzles = [showcase, ...pool.filter((p) => !(p.start === showcase.start && p.target === showcase.target))];
writeFileSync(outPath, JSON.stringify(puzzles) + '\n');

const parHist = puzzles.reduce((h, p) => ((h[p.par] = (h[p.par] ?? 0) + 1), h), {});
console.log(`subreddits:        ${names.length}`);
console.log(`districts:         ${Object.keys(districts).length}`);
console.log(`unreachable pairs: ${unreachablePairs}`);
console.log(`diameter:          ${maxPar}`);
console.log(`candidate puzzles: ${before}  too easy ${easyOut}, too hard ${hardOut}, kept ${candidates.length}`);
const keptOver = candidates.reduce((sum, c) => sum + ratings.get(c).over, 0) / candidates.length;
console.log(`kept puzzles:      bot averages ${keptOver.toFixed(2)} hops over par`);
console.log(`hops over par:     ${JSON.stringify(Object.fromEntries(Object.entries(spread).sort((x, y) => x[0] - y[0])))}`);
console.log(`puzzles written:   ${puzzles.length}  ${JSON.stringify(kept)}  par histogram ${JSON.stringify(parHist)}`);
console.log(`showcase:          r/${showcase.start} -> r/${showcase.target} par ${showcase.par}, ${showcaseRating.over.toFixed(2)} over par, ${showcase.level}`);
