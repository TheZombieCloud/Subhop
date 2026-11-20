import { Hono } from 'hono';
import { ensureDailyPost } from '../core/post';

export const scheduler = new Hono();

// Cron: midnight UTC, and a catch-up check every 15 minutes (see devvit.json).
// Posts the day's puzzle if it isn't up yet.
scheduler.post('/daily-post', async (c) => {
  try {
    const id = await ensureDailyPost();
    if (id) console.log(`daily post created: ${id}`);
    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('daily post failed', error);
    return c.json({ status: 'error' }, 500);
  }
});
