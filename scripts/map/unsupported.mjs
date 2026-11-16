// Replaces exits that have no support in the co-commenter data (not a direct link, not even
// two steps through another community on the map) with the source's strongest two-step neighbour.
// The general hubs (lounge) are left alone: their gateway links are deliberate (see tune.mjs).
// Usage: node scripts/map/unsupported.mjs <parsed.json> [--write]
//
// Without --write it lists every proposed swap. Many unsupported exits are intuitive (beer -> Coffee,
// vinyl -> musictheory) and only missing because the data keeps each community's top links, while the
// strongest two-step neighbour often leans on a big hub (audiophile -> nvidia). So --write applies only
// the swaps reviewed by hand in APPLY: a weak cross-topic jump replaced by a clearly better real link.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphPath = path.join(root, 'src/shared/graph.json');
const [, , parsedPath, flag] = process.argv;
const { edges } = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));
const g = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const districts = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/districts.json'), 'utf8'));
const dOf = new Map();
for (const [k, v] of Object.entries(districts)) for (const s of v) dOf.set(s, k);

const lc = (s) => s.toLowerCase();
const w = new Map();
const put = (a, b, x) => {
  const m = w.get(a) ?? new Map();
  m.set(b, Math.max(m.get(b) ?? 0, x));
  w.set(a, m);
};
for (const [a, list] of Object.entries(edges)) for (const [b, x] of list) (put(lc(a), lc(b), x), put(lc(b), lc(a), x));
const real = (a, b) => w.get(lc(a))?.get(lc(b)) ?? 0;
const names = Object.keys(g);
// Strength of a two-step link a -> x -> b: its weaker half, best over all x on the map.
const twoStep = (a, b) => {
  let best = 0;
  let via = null;
  for (const x of names) {
    if (x === a || x === b) continue;
    const v = Math.min(real(a, x), real(x, b));
    if (v > best) (best = v), (via = x);
  }
  return { best, via };
};
const supported = (a, b) => real(a, b) > 0 || twoStep(a, b).best > 0;

const APPLY = new Set([
  'Genshin_Impact>dankmemes', // -> OnePiece, via anime
  'TheDepthsBelow>urbanexploration', // -> AnimalsBeingBros, via likeus
  'TwoSentenceHorror>therewasanattempt', // -> worldbuilding, via WritingPrompts
  'ufc>Whatcouldgowrong', // -> SquaredCircle, via MMA
  'Bundesliga>IWantOut', // -> FantasyPL, via PremierLeague
  'beer>golf', // -> seriouseats, via BBQ
  'electricvehicles>Health', // -> technology, via teslamotors
]);
const IN_CAP = 20;
const inDeg = () => {
  const d = Object.fromEntries(names.map((n) => [n, 0]));
  for (const n of names) for (const e of g[n][1]) d[e]++;
  return d;
};

const changes = [];
const kept = [];
for (const a of names) {
  if (dOf.get(a) === 'lounge') continue;
  for (let i = 0; i < 6; i++) {
    const e = g[a][1][i];
    if (supported(a, e)) continue;
    const deg = inDeg();
    if (deg[e] <= 1) {
      kept.push(`${a} -> ${e} (its only way in)`);
      continue;
    }
    // Candidates: direct real links first, then two-step, strongest first; never a lounge hub or the start.
    let pick = null;
    let score = 0;
    let note = '';
    for (const b of names) {
      if (b === a || g[a][1].includes(b) || dOf.get(b) === 'lounge' || deg[b] >= IN_CAP) continue;
      const r = real(a, b);
      const s = r ? 1e9 + r : twoStep(a, b).best;
      if (s > score) (score = s), (pick = b), (note = r ? 'direct' : `via ${twoStep(a, b).via}`);
    }
    if (!pick) {
      kept.push(`${a} -> ${e} (no supported replacement)`);
      continue;
    }
    const ok = APPLY.has(`${a}>${e}`);
    if (ok) g[a][1][i] = pick;
    changes.push(`${ok ? 'APPLY ' : 'skip  '}r/${a}: r/${e} -> r/${pick} (${note})`);
  }
}
console.log(`unsupported exits with a possible swap: ${changes.length}:\n  ${changes.join('\n  ')}`);
if (kept.length) console.log(`left as is:\n  ${kept.join('\n  ')}`);
// Same layout as the hand-edited file: one community per line.
const lines = names.map((n) => `  ${JSON.stringify(n)}: [${JSON.stringify(g[n][0])}, ${JSON.stringify(g[n][1])}]`);
if (flag === '--write') fs.writeFileSync(graphPath, `{\n${lines.join(',\n')}\n}\n`);
