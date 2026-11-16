import { Hono } from 'hono';
import { createDailyPost } from '../core/post';

export const scheduler = new Hono();

// Cron: midnight UTC (see devvit.json). Posts the day's puzzle.
scheduler.post('/daily-post', async (c) => {
  try {
    const post = await createDailyPost();
    console.log(`daily post created: ${post.id}`);
    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('daily post failed', error);
    return c.json({ status: 'error' }, 500);
  }
});
