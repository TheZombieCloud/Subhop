import fs from 'node:fs';
const g = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const names = Object.keys(g);
const inDeg = Object.fromEntries(names.map((n) => [n, 0]));
for (const [, [, ex]] of Object.entries(g)) for (const e of ex) inDeg[e]++;
const hist = {}; let unreach = 0, cands = 0, maxd = 0; const parCands = {};
for (const s of names) {
  const dist = { [s]: 0 }, ways = { [s]: 1 }, q = [s];
  for (let i = 0; i < q.length; i++) { const c = q[i]; for (const n of g[c][1]) { if (!(n in dist)) { dist[n] = dist[c] + 1; ways[n] = 0; q.push(n); } if (dist[n] === dist[c] + 1) ways[n] += ways[c]; } }
  for (const t of names) { if (t === s) continue; if (!(t in dist)) { unreach++; continue; }
    hist[dist[t]] = (hist[dist[t]] ?? 0) + 1; maxd = Math.max(maxd, dist[t]);
    if (dist[t] >= 3 && dist[t] <= 4 && ways[t] <= 4 && inDeg[t] >= 4) { cands++; parCands[dist[t]] = (parCands[dist[t]] ?? 0) + 1; } }
  if (s === 'knitting') console.log('knitting->formula1 par', dist.formula1);
}
const tot = Object.values(hist).reduce((a, b) => a + b, 0);
console.log('nodes', names.length, 'unreachable pairs', unreach, 'diameter', maxd);
console.log('distance share', Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, (v / tot * 100).toFixed(1) + '%'])));
console.log('good puzzle candidates', cands, parCands);
const low = names.filter((n) => inDeg[n] < 4).length;
console.log('subs with in-degree < 4 (excluded as targets):', low);
