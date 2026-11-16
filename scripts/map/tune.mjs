// Hand-tuning pass: wire general hubs out to district gateways, and gateways down into their district.
// Usage: node tune.mjs parsed.json inDir outDir
import fs from 'node:fs';
import path from 'node:path';

const [, , parsedPath, inDir, outDir] = process.argv;
const { nodes, edges } = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(inDir, 'graph.json'), 'utf8'));
const districts = JSON.parse(fs.readFileSync(path.join(inDir, 'districts.json'), 'utf8'));

const lc = (s) => s.toLowerCase();
const count = new Map(Object.entries(nodes).map(([n, c]) => [lc(n), c]));
const size = (n) => count.get(lc(n)) ?? 0;
const und = new Map();
const out = new Map();
const put = (m, a, b, w) => {
  const x = m.get(a) ?? new Map();
  x.set(b, Math.max(x.get(b) ?? 0, w));
  m.set(a, x);
};
for (const [a, list] of Object.entries(edges)) {
  for (const [b, w] of list) {
    put(out, lc(a), lc(b), w);
    put(und, lc(a), lc(b), w);
    put(und, lc(b), lc(a), w);
  }
}
const realOut = (a) => [...(out.get(lc(a))?.entries() ?? [])].sort((p, q) => q[1] - p[1]).map(([b]) => b);
const linked = (a, b) => und.get(lc(a))?.has(lc(b)) ?? false;
const names = Object.keys(graph);
const byLc = new Map(names.map((n) => [lc(n), n]));
const districtOf = new Map();
for (const [d, subs] of Object.entries(districts)) for (const s of subs) districtOf.set(s, d);

const GENERALS = [
  'AskReddit', 'funny', 'pics', 'todayilearned', 'mildlyinteresting', 'interestingasfuck', 'videos', 'gifs',
  'Showerthoughts', 'explainlikeimfive', 'LifeProTips', 'nottheonion', 'Damnthatsinteresting', 'NoStupidQuestions',
  'oddlysatisfying', 'nextfuckinglevel',
].filter((g) => g in graph);

// Gateway per district: its biggest community (lounge is the generals' own district, so it has none).
// Chosen by hand: the community each topic actually centres on.
const gateway = {
  crafts: 'DIY', food: 'Cooking', home: 'gardening', world: 'travel', motors: 'cars', sports: 'sports',
  animals: 'aww', gaming: 'gaming', tech: 'technology', science: 'science', outdoors: 'Outdoors',
  fitness: 'Fitness', music: 'Music', screen: 'movies', arts: 'books', money: 'personalfinance',
};
for (const [d, g] of Object.entries(gateway)) if (!(g in graph) || districtOf.get(g) !== d) throw new Error(`gateway ${g} not in ${d}`);
const gateways = Object.values(gateway);
const changes = [];

// The top real exits of a sub that are on the map, strongest first.
const realOnMap = (a) => realOut(a).map((b) => byLc.get(b)).filter((b) => b && b !== a);

const indeg = () => {
  const d = Object.fromEntries(names.map((n) => [n, 0]));
  for (const [, [, ex]] of Object.entries(graph)) for (const e of ex) d[e]++;
  return d;
};
// Exits of `a` that are some community's only way in: these must survive any rewiring.
const mustKeep = (a) => {
  const d = indeg();
  return graph[a][1].filter((e) => d[e] === 1);
};

// Swap two-step fills for a direct real link to the district's gateway, where one exists.
const fills = new Set(
  fs.readFileSync(path.join(inDir, 'fills.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.replace(/ \(via .*\)$/, ''))
);
let swapped = 0;
for (const a of names) {
  const gw = gateway[districtOf.get(a)];
  if (!gw || gw === a || graph[a][1].includes(gw) || !linked(a, gw)) continue;
  const i = graph[a][1].findIndex((e) => fills.has(`${a} -> ${e}`) && indeg()[e] > 1);
  if (i < 0) continue;
  graph[a][1][i] = gw;
  swapped++;
}
changes.push(`two-step fills swapped for a real link to the gateway: ${swapped}`);

// Gateways: 3 strongest real exits, then 3 down into their district (biggest first, real link required).
for (const [d, gw] of Object.entries(gateway)) {
  const up = realOnMap(gw).slice(0, 3);
  const down = districts[d]
    .filter((s) => s !== gw && !up.includes(s) && linked(gw, s))
    .sort((a, b) => size(b) - size(a))
    .slice(0, 6 - up.length);
  const keep = mustKeep(gw).filter((s) => !up.includes(s));
  const fill = graph[gw][1].filter((s) => !up.includes(s) && !down.includes(s) && !keep.includes(s));
  const next = [...new Set([...keep, ...up, ...down, ...fill])].slice(0, 6);
  changes.push(`gateway ${d}: r/${gw} -> ${next.join(', ')}`);
  graph[gw][1] = next;
}

// Generals: 2 strongest real exits, then 4 gateways (real links first, then spread so every gateway is fed).
const fed = new Map(gateways.map((g) => [g, 0]));
for (const g of GENERALS) {
  const keep = realOnMap(g).filter((b) => !gateways.includes(b)).slice(0, 2);
  const realGw = realOnMap(g).filter((b) => gateways.includes(b));
  const picks = [];
  for (const gw of realGw) if (picks.length < 4) picks.push(gw);
  const rest = gateways.filter((gw) => !picks.includes(gw)).sort((a, b) => fed.get(a) - fed.get(b));
  for (const gw of rest) if (picks.length < 4) picks.push(gw);
  for (const gw of picks) fed.set(gw, fed.get(gw) + 1);
  const must = mustKeep(g).filter((s) => !keep.includes(s) && !picks.includes(s));
  graph[g][1] = [...must, ...keep, ...picks].slice(0, 6);
  changes.push(`general r/${g} -> ${graph[g][1].join(', ')}`);
}

// Nothing may become unreachable because of the rewiring.
const inDeg = Object.fromEntries(names.map((n) => [n, 0]));
for (const [, [, ex]] of Object.entries(graph)) for (const e of ex) inDeg[e]++;
const orphans = names.filter((n) => !inDeg[n]);
console.log(changes.join('\n'));
console.log('gateway in-links from generals', JSON.stringify(Object.fromEntries(fed)));
console.log('orphans after tuning:', orphans.join(' ') || 'none');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 1));
fs.writeFileSync(path.join(outDir, 'districts.json'), JSON.stringify(districts, null, 2));
