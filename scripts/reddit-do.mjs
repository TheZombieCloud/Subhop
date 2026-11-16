// Drives the window opened by reddit-browser.mjs.
//   node scripts/reddit-do.mjs shot <name>            screenshot current page
//   node scripts/reddit-do.mjs goto <url> <name>      navigate, wait, screenshot
//   node scripts/reddit-do.mjs click <text> <name>    click first visible element with that text
//                                                     (searches the page and every iframe)
//   node scripts/reddit-do.mjs frames                 list frames (URL) on the page
//   node scripts/reddit-do.mjs text                   print visible text of every frame
// Screenshots land in reddit-shots/. Console errors seen during the step are printed.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [cmd, a, b] = process.argv.slice(2);
mkdirSync('reddit-shots', { recursive: true });

const browser = await chromium.connectOverCDP('http://localhost:9333');
const ctx = browser.contexts()[0];
const page = ctx.pages().at(-1);
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const shot = async (name) => {
  await page.waitForTimeout(2500);
  const path = `reddit-shots/${name}.png`;
  await page.screenshot({ path });
  console.log(`SHOT ${path}`);
};

const clickText = async (text) => {
  for (const frame of page.frames()) {
    const loc = frame.getByText(text, { exact: false });
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        console.log(`CLICKED "${text}" in ${frame.url().slice(0, 80)}`);
        return;
      }
    }
  }
  throw new Error(`No visible element with text "${text}"`);
};

try {
  if (cmd === 'shot') await shot(a);
  else if (cmd === 'goto') {
    await page.goto(a, { waitUntil: 'domcontentloaded' });
    await shot(b);
  } else if (cmd === 'click') {
    await clickText(a);
    await shot(b);
  } else if (cmd === 'frames') {
    for (const f of page.frames()) console.log(f.url());
  } else if (cmd === 'text') {
    for (const f of page.frames()) {
      const t = await f.locator('body').innerText().catch(() => '');
      if (t.trim()) console.log(`--- ${f.url().slice(0, 90)}\n${t.slice(0, 1500)}`);
    }
  } else throw new Error('unknown command');
} finally {
  if (errors.length) console.log('CONSOLE\n' + errors.join('\n'));
  await browser.close(); // disconnects only; the window stays open
}
