// Build a ~500-community map from real co-commenter links (anvaka map-of-reddit data).
// Usage: node build.mjs parsed.json picks.txt graph.json districts.json outDir [target] [inCap]
import fs from 'node:fs';
import path from 'node:path';

const [, , parsedPath, picksPath, graphPath, districtsPath, outDir, targetArg = '500', capArg = '14'] = process.argv;
const TARGET = Number(targetArg);
const IN_CAP = Number(capArg);
const MIN_LINKS = 3;
const DISTRICT_CAP = 48;
const DROP = new Set(['steamdeck', 'theoffice', 'greatbritishbakeoff', 'warhammer40k', 'birding', 'talesfromthefrontdesk', 'eldenring', 'parenting']); // missing from the data, or no real links to the rest

const { nodes, edges } = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));
const oldGraph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const oldDistricts = JSON.parse(fs.readFileSync(districtsPath, 'utf8'));

const lc = (s) => s.toLowerCase();
const dataName = new Map(Object.keys(nodes).map((n) => [lc(n), n]));
const size = (k) => nodes[dataName.get(k)] ?? 0;

// Undirected link strength, keeping the direction it was observed in.
const out = new Map(); // a -> Map(b -> weight) as observed a->b
const und = new Map(); // a -> Map(b -> weight) either direction
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
const linkW = (a, b) => out.get(a)?.get(b) ?? (und.get(a)?.get(b) ?? 0) * 0.9;

// ---- choose the communities ----
const display = new Map();
const districtOf = new Map();
for (const [d, subs] of Object.entries(oldDistricts)) {
  for (const s of subs) {
    if (DROP.has(lc(s))) continue;
    display.set(lc(s), s);
    districtOf.set(lc(s), d);
  }
}
const kept = [...display.keys()];
const picks = [];
const unknown = [];
for (const line of fs.readFileSync(picksPath, 'utf8').split('\n')) {
  const m = /^(\w+):\s*(.*)$/.exec(line.trim());
  if (!m) continue;
  for (const name of m[2].split(/\s+/).filter(Boolean)) {
    const k = lc(name);
    if (display.has(k) || picks.some((p) => p.k === k)) continue;
    if (!dataName.has(k)) {
      unknown.push(name);
      continue;
    }
    picks.push({ k, name: dataName.get(k), district: m[1] });
  }
}
const pool = new Set([...kept, ...picks.map((p) => p.k)]);
const linksInto = (k, set) => [...(und.get(k)?.keys() ?? [])].filter((b) => b !== k && set.has(b)).length;

const chosen = new Set(kept);
const perDistrict = new Map();
for (const k of kept) perDistrict.set(districtOf.get(k), (perDistrict.get(districtOf.get(k)) ?? 0) + 1);
const skippedWeak = [];
const skippedCap = [];
for (const p of [...picks].sort((a, b) => size(b.k) - size(a.k))) {
  if (chosen.size >= TARGET) break;
  if (linksInto(p.k, pool) < MIN_LINKS) {
    skippedWeak.push(p.name);
    continue;
  }
  if ((perDistrict.get(p.district) ?? 0) >= DISTRICT_CAP) {
    skippedCap.push(p.name);
    continue;
  }
  chosen.add(p.k);
  display.set(p.k, p.name);
  districtOf.set(p.k, p.district);
  perDistrict.set(p.district, (perDistrict.get(p.district) ?? 0) + 1);
}

// ---- wire six exits each ----
const ranked = new Map();
for (const a of chosen) {
  const direct = [...(und.get(a)?.keys() ?? [])]
    .filter((b) => b !== a && chosen.has(b))
    .map((b) => ({ b, w: linkW(a, b), kind: 'real' }));
  const seen = new Set(direct.map((x) => x.b));
  const twoHop = new Map();
  for (const [x, w1] of und.get(a) ?? []) {
    for (const [b, w2] of und.get(x) ?? []) {
      if (b === a || !chosen.has(b) || seen.has(b)) continue;
      const w = Math.min(w1, w2) * 0.5;
      if (w > (twoHop.get(b)?.w ?? 0)) twoHop.set(b, { b, w, kind: 'via', via: display.get(x) ?? dataName.get(x) ?? x });
    }
  }
  ranked.set(a, [
    ...direct.sort((p, q) => q.w - p.w),
    ...[...twoHop.values()].sort((p, q) => q.w - p.w),
  ]);
}
const indeg = new Map();
const exits = new Map();
const order = [...chosen].sort((p, q) => ranked.get(p).filter((x) => x.kind === 'real').length - ranked.get(q).filter((x) => x.kind === 'real').length);
for (const a of order) {
  const pickList = [];
  for (const pass of [IN_CAP, Infinity]) {
    for (const c of ranked.get(a)) {
      if (pickList.length >= 6) break;
      if (pickList.some((x) => x.b === c.b)) continue;
      if ((indeg.get(c.b) ?? 0) >= pass) continue;
      pickList.push(c);
    }
  }
  for (const c of pickList) indeg.set(c.b, (indeg.get(c.b) ?? 0) + 1);
  exits.set(a, pickList);
}

// ---- repair: everything must be an exit from somewhere, through a real link if there is one ----
const repaired = [];
for (let round = 0; round < 5; round++) {
  const orphans = [...chosen].filter((k) => !(indeg.get(k) ?? 0));
  if (!orphans.length) break;
  for (const o of orphans) {
    // neighbours that really link to it, strongest first
    const froms = [...(und.get(o)?.entries() ?? [])]
      .filter(([a]) => chosen.has(a) && a !== o)
      .sort((p, q) => q[1] - p[1]);
    let done = false;
    for (const [a] of froms) {
      const list = exits.get(a);
      if (list.some((c) => c.b === o)) continue;
      // swap out a two-step fill first, else the weakest exit whose target can spare an in-link
      let idx = list.findIndex((c) => c.kind === 'via');
      if (idx < 0) {
        const spare = list.map((c, i) => ({ c, i })).filter(({ c }) => (indeg.get(c.b) ?? 0) > 2);
        if (!spare.length) continue;
        idx = spare[spare.length - 1].i;
      }
      const old = list[idx];
      indeg.set(old.b, (indeg.get(old.b) ?? 0) - 1);
      list[idx] = { b: o, w: linkW(a, o), kind: 'real' };
      indeg.set(o, (indeg.get(o) ?? 0) + 1);
      repaired.push(`${display.get(a)} -> ${display.get(o)} (replaced ${display.get(old.b)})`);
      done = true;
      break;
    }
    if (!done) repaired.push(`COULD NOT place ${display.get(o)}`);
  }
}
console.log(`repairs: ${repaired.length}`);
for (const r of repaired) console.log(`  ${r}`);

// ---- repair: no dead-end clusters (every community must be able to reach every other) ----
const sccs = () => {
  const ids = [...chosen];
  const index = new Map(), low = new Map(), on = new Set(), stack = [], comp = new Map();
  let i = 0, c = 0;
  const strong = (v0) => {
    const work = [[v0, 0]];
    index.set(v0, i); low.set(v0, i); i++; stack.push(v0); on.add(v0);
    while (work.length) {
      const top = work[work.length - 1];
      const [v, ei] = top;
      const nbrs = exits.get(v).map((x) => x.b);
      if (ei < nbrs.length) {
        top[1]++;
        const w = nbrs[ei];
        if (!index.has(w)) { index.set(w, i); low.set(w, i); i++; stack.push(w); on.add(w); work.push([w, 0]); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
        if (low.get(v) === index.get(v)) { let w; do { w = stack.pop(); on.delete(w); comp.set(w, c); } while (w !== v); c++; }
      }
    }
  };
  for (const v of ids) if (!index.has(v)) strong(v);
  return { comp, count: c };
};
const bridged = [];
for (let round = 0; round < 60; round++) {
  const { comp, count } = sccs();
  if (count === 1) break;
  const sizes = new Map();
  for (const v of comp.values()) sizes.set(v, (sizes.get(v) ?? 0) + 1);
  const main = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
  const hasOut = new Set();
  for (const [a, list] of exits) for (const x of list) if (comp.get(x.b) !== comp.get(a)) hasOut.add(comp.get(a));
  // a sink cluster (no way out): add its strongest real link to the main cluster
  const sinks = [...sizes.keys()].filter((k) => !hasOut.has(k));
  for (const sink of sinks) {
    let best = null;
    for (const a of chosen) {
      if (comp.get(a) !== sink) continue;
      for (const [o, w] of und.get(a) ?? []) {
        if (!chosen.has(o) || comp.get(o) === sink) continue;
        const score = w * (comp.get(o) === main ? 2 : 1);
        if (!best || score > best.score) best = { a, o, score };
      }
    }
    if (!best) { bridged.push(`COULD NOT bridge cluster of ${[...chosen].filter((v) => comp.get(v) === sink).map((v) => display.get(v)).join(',')}`); continue; }
    const list = exits.get(best.a);
    let idx = list.findIndex((c2) => c2.kind === 'via');
    if (idx < 0) idx = list.length - 1;
    const old = list[idx];
    if ((indeg.get(old.b) ?? 0) <= 1) idx = list.findIndex((c2) => (indeg.get(c2.b) ?? 0) > 1);
    const gone = list[idx];
    indeg.set(gone.b, (indeg.get(gone.b) ?? 0) - 1);
    list[idx] = { b: best.o, w: linkW(best.a, best.o), kind: 'real' };
    indeg.set(best.o, (indeg.get(best.o) ?? 0) + 1);
    bridged.push(`${display.get(best.a)} -> ${display.get(best.o)} (replaced ${display.get(gone.b)})`);
  }
}
console.log(`bridges out of dead-end clusters: ${bridged.length}`);
for (const r of bridged) console.log(`  ${r}`);

// ---- report ----
let real = 0, via = 0;
const fills = [];
for (const [a, list] of exits) {
  for (const c of list) {
    if (c.kind === 'real') real++;
    else {
      via++;
      fills.push(`${display.get(a)} -> ${display.get(c.b)} (via ${c.via})`);
    }
  }
}
const short = [...exits].filter(([, l]) => l.length < 6).map(([a]) => display.get(a));
const degs = [...chosen].map((k) => indeg.get(k) ?? 0).sort((p, q) => q - p);
const unreached = [...chosen].filter((k) => !(indeg.get(k) ?? 0)).map((k) => display.get(k));
console.log(`chosen ${chosen.size} (kept ${kept.length}, added ${chosen.size - kept.length})`);
console.log('per district', JSON.stringify(Object.fromEntries(perDistrict)));
console.log(`exits: ${real} real, ${via} two-step fills; short lists: ${short.join(' ') || 'none'}`);
console.log(`in-degree max ${degs[0]}, top: ${[...chosen].sort((p, q) => (indeg.get(q) ?? 0) - (indeg.get(p) ?? 0)).slice(0, 12).map((k) => `${display.get(k)}:${indeg.get(k)}`).join(' ')}`);
console.log(`never an exit: ${unreached.length} ${unreached.slice(0, 30).join(' ')}`);
console.log(`unknown picks: ${unknown.join(' ') || 'none'}`);
console.log(`skipped (weak links): ${skippedWeak.length} ${skippedWeak.join(' ')}`);
console.log(`skipped (district full): ${skippedCap.length} ${skippedCap.join(' ')}`);

fs.mkdirSync(outDir, { recursive: true });
const graph = {};
for (const k of [...chosen].sort()) {
  const name = display.get(k);
  const desc = oldGraph[name]?.[0] ?? '';
  graph[name] = [desc, exits.get(k).map((c) => display.get(c.b))];
}
const districts = {};
for (const d of Object.keys(oldDistricts)) districts[d] = [];
for (const k of chosen) districts[districtOf.get(k)].push(display.get(k));
fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 1));
fs.writeFileSync(path.join(outDir, 'districts.json'), JSON.stringify(districts, null, 2));
fs.writeFileSync(path.join(outDir, 'fills.txt'), fills.join('\n'));
