import fs from 'node:fs';
const [,, dotPath, outPath] = process.argv;
const txt = fs.readFileSync(dotPath, 'utf8');
const nodes = {}; const edges = {};
const edgeRe = /^"([^"]+)" -> "([^"]+)" \["weight"=([\d.]+)\]/;
const nodeRe = /^"([^"]+)" \["count"=(\d+)/;
for (const line of txt.split('\n')) {
  let m = edgeRe.exec(line);
  if (m) { (edges[m[1]] ??= []).push([m[2], +m[3]]); continue; }
  m = nodeRe.exec(line);
  if (m) nodes[m[1]] = +m[2];
}
fs.writeFileSync(outPath, JSON.stringify({ nodes, edges }));
const top = Object.entries(nodes).sort((a, b) => b[1] - a[1]);
console.log('nodes', top.length, 'with edges', Object.keys(edges).length);
console.log(top.slice(0, 40).map(([n, c]) => `${n}:${c}`).join(' '));
