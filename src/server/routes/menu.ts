import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import { puzzleIdForPost, resetRun, todayId } from '../core/game';
import { resetProposalsFor } from '../core/proposals';
import { nodeNames } from '../../shared/graph';
import { getHomeConfig, HOME_MODES, MAX_HOME_EXITS, MIN_HOME_EXITS, sidebarRelated } from '../core/net';
import { createDailyPost, createTestPost } from '../core/post';
import { puzzleReport, statKeys } from '../core/stats';

export const menu = new Hono();

const handle = (create: () => ReturnType<typeof createDailyPost>) => async () => {
  const post = await create();
  return `https://reddit.com/r/${context.subredditName}/comments/${post.id}`;
};

menu.post('/post-daily', async (c) => {
  try {
    return c.json<UiResponse>({ navigateTo: await handle(createDailyPost)() });
  } catch (error) {
    console.error('post-daily failed', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

menu.post('/post-test', async (c) => {
  try {
    return c.json<UiResponse>({ navigateTo: await handle(createTestPost)() });
  } catch (error) {
    console.error('post-test failed', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

// Testing aid (mods only, on a Subhop post): forget your run on this post so you can replay it,
// and take back your proposal and vote for tomorrow.
menu.post('/reset-me', async (c) => {
  const [username, pid] = await Promise.all([reddit.getCurrentUsername(), puzzleIdForPost(context.postId)]);
  if (!username || !context.postId) return c.json<UiResponse>({ showToast: 'Open this from a Subhop post' }, 400);
  const linked = await redis.get(`post:${context.postId}`);
  if (!linked) return c.json<UiResponse>({ showToast: 'This isn’t a Subhop post' });
  const hadRun = await resetRun(pid, username);
  await resetProposalsFor(username);
  return c.json<UiResponse>({
    showToast: {
      text: hadRun ? 'Your run is reset. Reload the post to play again.' : 'Nothing to reset on this post. Proposal and vote cleared.',
      appearance: 'success',
    },
  });
});

// Same, from the subreddit menu: resets your run on today's daily.
menu.post('/reset-today', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json<UiResponse>({ showToast: 'Log in first' }, 400);
  const hadRun = await resetRun(todayId(), username);
  await resetProposalsFor(username);
  return c.json<UiResponse>({
    showToast: {
      text: hadRun ? 'Today’s run is reset. Reload the daily post to play again.' : 'No run today yet. Proposal and vote cleared.',
      appearance: 'success',
    },
  });
});

// Mods only: throw away today's daily and make it again from the current puzzle pool, then post it.
// Today's leaderboard and stats go with it, and so does the mod's own run. Other players' runs
// can't be listed (Redis can't enumerate keys), so this is meant for a day nobody has played yet.
menu.post('/reroll-today', async (c) => {
  try {
    const pid = todayId();
    const username = await reddit.getCurrentUsername();
    await redis.del(`puzzle:${pid}`, `lb:${pid}`, `paths:${pid}`, `first:${pid}`, `hops:${pid}`, ...statKeys(pid));
    if (username) await resetRun(pid, username);
    return c.json<UiResponse>({ navigateTo: await handle(createDailyPost)() });
  } catch (error) {
    console.error('reroll-today failed', error);
    return c.json<UiResponse>({ showToast: 'Failed to re-roll today’s puzzle' }, 400);
  }
});

// Mods only, on a Subhop post: how that puzzle is going (views, starts, finishes, where people quit).
menu.post('/puzzle-stats', async (c) => {
  if (!context.postId || !(await redis.get(`post:${context.postId}`))) {
    return c.json<UiResponse>({ showToast: 'Open this from a Subhop post' });
  }
  const pid = await puzzleIdForPost(context.postId);
  return c.json<UiResponse>({
    showForm: {
      name: 'puzzleStats',
      form: { title: `Stats for ${pid}`, description: await puzzleReport(pid), acceptLabel: 'Close', fields: [] },
    },
  });
});

// Anyone: delete everything Subhop stores about you here. Asks first; the form does the deleting.
menu.post('/delete-my-data', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json<UiResponse>({ showToast: 'Log in first' }, 400);
  return c.json<UiResponse>({
    showForm: {
      name: 'deleteMyData',
      form: {
        title: 'Delete your Subhop data?',
        description: `This removes u/${username}'s runs, scores, passport stamps, streak and streak flair, and tomorrow's vote and proposal in r/${context.subredditName}. It can't be undone. Your comments stay; delete them yourself if you want.`,
        acceptLabel: 'Delete my data',
        fields: [],
      },
    },
  });
});

// Mods choose where their community sits in daily journeys: the destination, the
// departure, alternating, or off. If the sub isn't on the built-in map, they also wire it
// in by picking where their members hang out, pre-filled from their sidebar's
// "Related communities" list.
menu.post('/home-setup', async (c) => {
  const home = await getHomeConfig();
  if (!home) return c.json<UiResponse>({ showToast: 'Open this from a subreddit' }, 400);
  const options = nodeNames()
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .map((n) => ({ label: `r/${n}`, value: n }));
  const related = home.onMap || home.exits.length ? [] : await sidebarRelated(home.sub);
  const exitsDefault = home.exits.length ? home.exits : related.slice(0, MAX_HOME_EXITS);
  const exitsHelp = related.length
    ? `Pre-filled from your sidebar’s related communities. Pick ${MIN_HOME_EXITS}–${MAX_HOME_EXITS}.`
    : `Pick ${MIN_HOME_EXITS}–${MAX_HOME_EXITS}. They become the doors in and out of r/${home.sub}.`;
  return c.json<UiResponse>({
    showForm: {
      name: 'homeSetup',
      form: {
        title: `Put r/${home.sub} on the map`,
        description: home.onMap
          ? `r/${home.sub} is already on the Subhop map. Choose where it sits in daily journeys. Applies from the next daily.`
          : `Daily journeys can start or end at r/${home.sub}. Choose where it sits, and which communities your members also hang out in. Applies from the next daily; post a test puzzle to preview it now.`,
        acceptLabel: 'Save',
        fields: [
          {
            type: 'select',
            name: 'mode',
            label: `Where does r/${home.sub} sit in daily journeys?`,
            options: HOME_MODES.map((m) => ({ label: m.label, value: m.value })),
            defaultValue: [home.mode === 'off' && !home.exits.length ? 'end' : home.mode],
            required: true,
          },
          ...(home.onMap
            ? []
            : [
                {
                  type: 'select' as const,
                  name: 'exits',
                  label: `Where else do r/${home.sub} members hang out?`,
                  helpText: exitsHelp,
                  options,
                  multiSelect: true,
                  defaultValue: exitsDefault,
                },
              ]),
        ],
      },
    },
  });
});
