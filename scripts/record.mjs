// Records scripted playthroughs of the demo build (demo/ + mock backend) as MP4s, plus stills,
// and writes recordings/index.html to watch them all.
//
//   npm run record                  # build demo, record every scenario
//   npm run record -- detour home   # only scenarios whose name contains one of these words
//
// Needs Chrome or Edge (or CHROME_PATH) and ffmpeg on PATH (or FFMPEG).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'dist-demo');
const out = join(root, 'recordings');
const filters = process.argv.slice(2).map((f) => f.toLowerCase());

// ---- tools ----
const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
const ffmpeg = process.env.FFMPEG ?? (existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg');
if (spawnSync(ffmpeg, ['-version']).status !== 0) throw new Error('ffmpeg not found. Install it or set FFMPEG.');
if (!existsSync(join(site, 'game.html'))) throw new Error('dist-demo missing. Run: npm run record (it builds first).');

// ---- static server for dist-demo ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(site) || !existsSync(path)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- recording helpers ----
const PHONE = { width: 390, height: 844 };
const FEED = { width: 390, height: 520 };

const makeActions = (page, stills, name, captions) => {
  const tapMarker = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.evaluate(({ x, y }) => {
      const el = document.createElement('div');
      el.className = 'demo-tap';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      document.body.append(el);
      setTimeout(() => el.remove(), 700);
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  };
  const a = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    demo: () => page.evaluate(() => window.__demo),
    async tap(locator, after = 900) {
      await locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await tapMarker(locator);
      await locator.tap();
      await page.waitForTimeout(after);
    },
    button: (text) => page.getByRole('button', { name: text }).first(),
    exit: (sub) =>
      page.locator('button.exit').filter({ has: page.locator('.exit-sub', { hasText: new RegExp(`^r/${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }),
    async hop(sub) {
      await a.tap(a.exit(sub), 1300);
    },
    async hopRoute(route) {
      for (const sub of route.slice(1)) await a.hop(sub);
    },
    async scrollThrough(step = 260, pause = 700) {
      for (let i = 0; i < 12; i++) {
        const atEnd = await page.evaluate(() => window.innerHeight + window.scrollY >= document.body.scrollHeight - 4);
        if (atEnd) break;
        await page.mouse.wheel(0, step);
        await page.waitForTimeout(pause);
      }
    },
    async scrollTop() {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(700);
    },
    /** Caption shown beside the phone from now until the next one (captioned video only). */
    caption(text) {
      captions.push({ t: Date.now() / 1000, text });
    },
    async still(label) {
      const file = `${name}-${String(stills.length + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: join(out, file) });
      stills.push({ file, label });
    },
  };
  return a;
};

const encode = (frames, endT, file) => {
  const dir = join(tmpdir(), `subhop-rec-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1]?.t ?? endT;
    lines.push(`file '${name}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const r = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
    { cwd: dir, encoding: 'utf8' }
  );
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

// Captioned version for sharing: 1920x1080, the phone on the left, the current caption on the right.
const fontUrl = (pkg, w) => pathToFileURL(join(root, `node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`)).href;
const encodeCaptioned = async (browser, frames, endT, captions, file) => {
  const dir = join(tmpdir(), `subhop-cap-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const t0 = frames[0].t;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const caps = ['ffconcat version 1.0'];
  for (const [i, c] of captions.entries()) {
    const html = join(dir, `c${i}.html`);
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:RS;font-weight:800;src:url(${fontUrl('reddit-sans', 800)})}
@font-face{font-family:RSC;font-weight:800;src:url(${fontUrl('reddit-sans-condensed', 800)})}
*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;background:#1d2b4a;position:relative}
.frame{position:absolute;left:232px;top:22px;width:498px;height:1036px;border-radius:26px;background:#0e1628}
.side{position:absolute;left:860px;right:120px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.brand{font:800 34px RSC;letter-spacing:.3em;color:#d8b65a;margin-bottom:34px}
p{font:800 66px/1.18 RS;color:#f3e6c4}
</style><div class="frame"></div><div class="side"><div class="brand">SUBHOP</div><p>${c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></div>`
    );
    await page.goto(pathToFileURL(html).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, `c${i}.png`) });
    const from = i === 0 ? t0 : c.t;
    const to = captions[i + 1]?.t ?? endT;
    caps.push(`file 'c${i}.png'`, `duration ${Math.max(0.05, to - from).toFixed(3)}`);
  }
  caps.push(`file 'c${captions.length - 1}.png'`);
  writeFileSync(join(dir, 'caps.txt'), caps.join('\n'));
  await page.close();
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    lines.push(`file '${name}'`, `duration ${Math.max(0.001, (frames[i + 1]?.t ?? endT) - f.t).toFixed(4)}`);
  });
  lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const r = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'caps.txt', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-filter_complex', '[0:v]fps=30[bg];[1:v]fps=30,scale=462:1000[ph];[bg][ph]overlay=250:40:shortest=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
    { cwd: dir, encoding: 'utf8' }
  );
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

// ---- scenarios ----
const SCENARIOS = [
  {
    name: 'feed-card',
    title: 'Feed card (not played yet)',
    note: 'What people see scrolling past the post.',
    url: 'splash.html?s=daily',
    size: FEED,
    run: async (a) => {
      await a.wait(1800);
      await a.still('Feed card');
      await a.wait(1500);
    },
  },
  {
    name: 'feed-card-played',
    title: 'Feed card (already played)',
    note: 'Returning player: their result, rank and the countdown.',
    url: 'splash.html?s=played',
    size: FEED,
    run: async (a) => {
      await a.wait(1800);
      await a.still('Feed card after playing');
      await a.wait(1200);
    },
  },
  {
    name: 'first-play',
    title: 'First play with a wrong turn',
    note: 'Intro, a wrong hop, stepping back, then the right route to the results and full leaderboard.',
    url: 'game.html?s=daily',
    run: async (a) => {
      const { route } = await a.demo();
      a.caption(`Today’s puzzle: get from r/${route[0]} to r/${route.at(-1)}.`);
      await a.wait(2600);
      await a.still('Intro');
      await a.scrollThrough(220, 600);
      await a.scrollTop();
      a.caption('Each community shows six others that share its commenters. I tap one to go there.');
      await a.tap(a.button(/Start the journey/), 2600);
      await a.still('First community');
      const exits = await a.page.locator('button.exit .exit-sub').allInnerTexts();
      const wrong = exits.map((t) => t.replace(/^r\//, '')).find((s) => s !== route[1] && s !== route.at(-1));
      if (wrong) {
        a.caption('I guess wrong here, but I still get a stamp for it.');
        await a.hop(wrong);
        await a.wait(1800);
        await a.still('Wrong turn (new stamp?)');
        a.caption('I can step back, but it costs me a hop.');
        await a.tap(a.button(/Step back/), 2200);
      }
      a.caption(`The shortest route is ${route.join(' → ')}.`);
      await a.hopRoute(route);
      await a.wait(1200);
      a.caption(`I got there in ${route.length - 1 + (wrong ? 2 : 0)} hops. Par was ${route.length - 1}.`);
      await a.wait(2800);
      await a.still('Results');
      a.caption('My passport keeps a stamp for every community I’ve been through.');
      await a.tap(a.button(/^Your passport$/), 1800);
      await a.still('Passport');
      await a.scrollThrough(300, 600);
      a.caption('After that I can vote on tomorrow’s puzzle.');
      await a.tap(a.button(/Back to your results/), 1200);
      await a.scrollThrough(240, 1100);
      await a.still('Results, bottom');
      a.caption('This is how the other players got there.');
      await a.tap(a.button(/How everyone else did/), 1000);
      await a.scrollThrough(260, 900);
      await a.still('Today’s stats');
      a.caption('Fewest hops wins and time breaks ties. There’s a new puzzle every day.');
      await a.tap(a.button(/^All [0-9,]+$/), 3000);
      await a.still('Full leaderboard');
    },
  },
  {
    name: 'roadblock',
    title: 'Twist: Roadblock (perfect run + share)',
    note: 'A closed sub on the obvious route, a par run, confetti, then sharing as a comment.',
    url: 'game.html?s=roadblock',
    run: async (a) => {
      const { route } = await a.demo();
      await a.wait(1500);
      await a.still('Intro with twist');
      await a.tap(a.button(/Start the journey/), 1400);
      await a.still('Closed exit');
      await a.hopRoute(route);
      await a.wait(1600);
      await a.still('Perfect run');
      await a.tap(a.button(/Post my result/), 1800);
      await a.scrollThrough(260, 800);
    },
  },
  {
    name: 'detour',
    title: 'Twist: Detour',
    note: 'Must pass through a given sub before the target unlocks.',
    url: 'game.html?s=detour',
    run: async (a) => {
      const { route } = await a.demo();
      await a.wait(1500);
      await a.still('Intro with twist');
      await a.tap(a.button(/Start the journey/), 1400);
      await a.hopRoute(route);
      await a.wait(1400);
      await a.still('Results');
    },
  },
  {
    name: 'no-return',
    title: 'Twist: No return',
    note: 'Step back is replaced by a note; every hop is final.',
    url: 'game.html?s=noreturn',
    run: async (a) => {
      const { route } = await a.demo();
      await a.wait(1500);
      await a.tap(a.button(/Start the journey/), 1400);
      await a.still('No step back');
      await a.hopRoute(route);
      await a.wait(1400);
    },
  },
  {
    name: 'home',
    title: 'Home destination',
    note: 'An off-map community (r/SubhopClub) as the destination, wired in via three subs.',
    url: 'game.html?s=home',
    run: async (a) => {
      const { route } = await a.demo();
      await a.wait(1500);
      await a.still('Intro (home)');
      await a.tap(a.button(/Start the journey/), 1400);
      await a.hopRoute(route);
      await a.wait(1600);
      await a.still('Arrived home');
    },
  },
  {
    name: 'home-start',
    title: 'Journey from home + proposing tomorrow',
    note: 'Starts at r/SubhopClub. After arriving: vote, then propose tomorrow’s journey (tomorrow starts at home too).',
    url: 'game.html?s=homestart',
    run: async (a) => {
      const { route } = await a.demo();
      await a.wait(1500);
      await a.still('Intro (from home)');
      await a.tap(a.button(/Start the journey/), 1400);
      await a.hopRoute(route);
      await a.wait(1600);
      const section = a.page.locator('.proposals');
      await section.scrollIntoViewIfNeeded();
      await a.wait(700);
      await a.still('Tomorrow’s journey');
      await a.tap(section.locator('button.vote').nth(1), 900);
      await a.tap(a.button(/Propose a journey/), 900);
      const to = a.page.locator('.prop-form select');
      await to.scrollIntoViewIfNeeded();
      await to.selectOption('nba');
      await a.wait(900);
      await a.still('Propose form');
      await a.tap(a.button(/^Propose r\//), 1200);
      await section.scrollIntoViewIfNeeded();
      await a.wait(600);
      await a.still('Proposed');
    },
  },
  {
    name: 'picked-by',
    title: 'A player-picked daily',
    note: 'Yesterday’s most-voted proposal became today’s puzzle, credited to the player.',
    url: 'game.html?s=proposed',
    run: async (a) => {
      await a.wait(1500);
      await a.still('Intro (picked by a player)');
      await a.wait(800);
    },
  },
  {
    name: 'give-up',
    title: 'Giving up',
    note: 'Two-tap give up and the DNF results.',
    url: 'game.html?s=daily',
    run: async (a) => {
      const { route } = await a.demo();
      await a.wait(1200);
      await a.tap(a.button(/Start the journey/), 1300);
      await a.hop(route[1]);
      await a.tap(a.button(/^Give up$/), 900);
      await a.tap(a.button(/Tap again to give up/), 1500);
      await a.still('DNF results');
      await a.scrollThrough(260, 800);
      await a.tap(a.button(/^Follow$/), 900);
      await a.still('Follow ticket');
    },
  },
];

// ---- run ----
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--hide-scrollbars'] });
const done = [];
const chosen = SCENARIOS.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));
for (const s of chosen) {
  const size = s.size ?? PHONE;
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: size.width * 2, maxHeight: size.height * 2 });
  await page.goto(`${base}/${s.url}`);
  const stills = [];
  const captions = [];
  process.stdout.write(`recording ${s.name}… `);
  try {
    await s.run(makeActions(page, stills, s.name, captions));
    await page.waitForTimeout(800);
  } catch (e) {
    console.log(`FAILED: ${e.message.split('\n')[0]}`);
  }
  const endT = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await context.close();
  if (!frames.length) {
    console.log('no frames');
    continue;
  }
  encode(frames, endT, join(out, `${s.name}.mp4`));
  if (captions.length) await encodeCaptioned(browser, frames, endT, captions, join(out, `${s.name}-captioned.mp4`));
  done.push({ ...s, stills, seconds: Math.round(endT - frames[0].t) });
  console.log(`${Math.round(endT - frames[0].t)}s, ${stills.length} stills`);
}
await browser.close();
server.close();

// ---- gallery (keeps entries for scenarios not re-recorded this run) ----
const manifestPath = join(out, 'manifest.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const merged = SCENARIOS.map((s) => done.find((d) => d.name === s.name) ?? previous.find((p) => p.name === s.name)).filter(Boolean)
  .map(({ run, size, ...rest }) => rest);
writeFileSync(manifestPath, JSON.stringify(merged, null, 2));

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stamp = new Date().toLocaleString('en-GB');
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Subhop recordings</title>
<style>
:root{color-scheme:dark;--bg:#0f1216;--card:#1b2129;--line:#2b333d;--text:#f1f3f5;--muted:#9aa4b0}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px;font-size:22px}.sub{color:var(--muted);margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.card h2{margin:0;font-size:16px}.card p{margin:0;color:var(--muted);font-size:14px}
video{width:100%;border-radius:10px;background:#000}
.stills{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.stills a{flex:none;width:78px;color:var(--muted);font-size:11px;text-decoration:none}
.stills img{width:78px;border-radius:6px;display:block;margin-bottom:4px;border:1px solid var(--line)}
code{background:#000;padding:1px 6px;border-radius:5px}
</style></head><body><main>
<h1>Subhop recordings</h1>
<p class="sub">Updated ${esc(stamp)} · local demo build with mock data (fake players, peeks and crowd stats) · re-record with <code>npm run record</code></p>
<div class="grid">
${merged
  .map(
    (s) => `<section class="card"><h2>${esc(s.title)}</h2><p>${esc(s.note)} · ${s.seconds}s</p>
<video src="${s.name}.mp4" controls muted playsinline preload="metadata"${s.stills[0] ? ` poster="${s.stills[0].file}"` : ''}></video>
<div class="stills">${s.stills.map((st) => `<a href="${st.file}" target="_blank"><img src="${st.file}" alt="${esc(st.label)}">${esc(st.label)}</a>`).join('')}</div></section>`
  )
  .join('\n')}
</div></main></body></html>`
);
console.log(`\nOpen ${join(out, 'index.html')}`);
