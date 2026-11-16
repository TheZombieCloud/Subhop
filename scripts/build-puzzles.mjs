// Validates src/shared/graph.json and generates src/shared/puzzles.json.
// Run: npm run puzzles
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// ---- fairness: can topic sense solve it? ----
// A simulated player who sees only exit names and their district (as the game shows them), never the
// map. They take the target if it's an exit, else head for the target's district (through its main
// community if they're outside it), else a hub, else anything new. A puzzle is kept only if this player
// usually arrives close to par: hard because the route is clever, not because the map is a maze.
const GATEWAY = {
  crafts: 'DIY', food: 'Cooking', home: 'gardening', world: 'travel', motors: 'cars', sports: 'sports',
  animals: 'aww', gaming: 'gaming', tech: 'technology', science: 'science', outdoors: 'Outdoors',
  fitness: 'Fitness', music: 'Music', screen: 'movies', arts: 'books', money: 'personalfinance',
};
const gateways = new Set(Object.values(GATEWAY));
const pick = (list) => list[Math.floor(rand() * list.length)];
const sensibleHops = (start, target, cap = 20) => {
  const td = districtOf.get(target);
  const seen = new Set([start]);
  let here = start;
  for (let hops = 1; hops <= cap; hops++) {
    const exits = graph[here][1];
    const fresh = exits.filter((e) => !seen.has(e));
    const opts = fresh.length ? fresh : exits;
    const same = opts.filter((o) => districtOf.get(o) === td);
    const hubs = opts.filter((o) => districtOf.get(o) === 'lounge' || gateways.has(o));
    if (opts.includes(target)) return hops;
    if (same.length) here = same.includes(GATEWAY[td]) && districtOf.get(here) !== td ? GATEWAY[td] : pick(same);
    else if (opts.includes(GATEWAY[td])) here = GATEWAY[td];
    else here = pick(hubs.length ? hubs : opts);
    seen.add(here);
  }
  return null;
};
const TRIALS = 24;
const fair = (c) => {
  let near = 0;
  for (let i = 0; i < TRIALS; i++) {
    const h = sensibleHops(c.start, c.target);
    if (h !== null && h <= c.par + 2) near++;
  }
  return near / TRIALS;
};
const FAIR_MIN = 0.6; // at least 60% of sensible runs finish within par + 2
const before = candidates.length;
const fairness = new Map(candidates.map((c) => [c, fair(c)]));
candidates.splice(0, candidates.length, ...candidates.filter((c) => fairness.get(c) >= FAIR_MIN));
for (let i = candidates.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}

// Avoid repeating a start or target within a 10-day window.
const pool = [];
const recent = [];
for (const c of candidates) {
  if (recent.some((r) => r.start === c.start || r.target === c.target || r.start === c.target)) continue;
  pool.push({ start: c.start, target: c.target, par: c.par });
  recent.push(c);
  if (recent.length > 10) recent.shift();
  if (pool.length >= 730) break;
}

// Puzzle #1 is the showcase.
const showcase = { start: 'batman', target: 'knitting', par: bfs('batman').dist.knitting };
const puzzles = [showcase, ...pool.filter((p) => !(p.start === showcase.start && p.target === showcase.target))];
writeFileSync(outPath, JSON.stringify(puzzles) + '\n');

const parHist = puzzles.reduce((h, p) => ((h[p.par] = (h[p.par] ?? 0) + 1), h), {});
console.log(`subreddits:        ${names.length}`);
console.log(`districts:         ${Object.keys(districts).length}`);
console.log(`unreachable pairs: ${unreachablePairs}`);
console.log(`diameter:          ${maxPar}`);
console.log(`candidate puzzles: ${before}, fair to topic sense: ${candidates.length}`);
console.log(`puzzles written:   ${puzzles.length}  par histogram ${JSON.stringify(parHist)}`);
console.log(`showcase:          r/${showcase.start} -> r/${showcase.target} par ${showcase.par}, fair ${fair(showcase).toFixed(2)}`);
