import fs from 'node:fs';
const g = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const d = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const dOf = new Map(); for (const [k, v] of Object.entries(d)) for (const s of v) dOf.set(s, k);
const names = Object.keys(g);
const inDeg = Object.fromEntries(names.map((n) => [n, 0])); for (const [, [, ex]] of Object.entries(g)) for (const e of ex) inDeg[e]++;
let cross = 0, same = 0; const samples = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const s of names) {
  const dist = { [s]: 0 }, ways = { [s]: 1 }, prev = { [s]: null }, q = [s];
  for (let i = 0; i < q.length; i++) { const c = q[i]; for (const n of g[c][1]) { if (!(n in dist)) { dist[n] = dist[c] + 1; ways[n] = 0; prev[n] = c; q.push(n); } if (dist[n] === dist[c] + 1) ways[n] += ways[c]; } }
  for (const t of names) {
    if (t === s || !(dist[t] >= 3 && dist[t] <= 4 && ways[t] <= 4 && inDeg[t] >= 4)) continue;
    if (dOf.get(s) === dOf.get(t)) same++; else cross++;
    if (rnd() < 0.0006) { const path = []; for (let x = t; x; x = prev[x]) path.unshift(x); samples.push(`${path.join(' > ')}  [${dOf.get(s)} -> ${dOf.get(t)}]`); }
  }
}
console.log('par 3-4 candidates: cross-district', cross, 'same-district', same);
console.log(samples.slice(0, 30).join('\n'));
