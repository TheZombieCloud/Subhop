// Opens a phone-sized Chrome window with its own profile (.reddit-profile/, gitignored)
// and keeps it running so other scripts can drive it over CDP on port 9333.
// You log in to Reddit in this window yourself; the login stays in that profile.
//
//   node scripts/reddit-browser.mjs
//   node scripts/reddit-do.mjs <url> [shot-name]   (separate terminal)
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome or Edge not found');

const ctx = await chromium.launchPersistentContext('.reddit-profile', {
  executablePath,
  headless: false,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  args: ['--remote-debugging-port=9333', '--window-size=430,960'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.reddit.com/login/');
console.log('READY: log in to Reddit in the window, then tell Claude.');
ctx.on('close', () => process.exit(0));
await new Promise(() => {});
