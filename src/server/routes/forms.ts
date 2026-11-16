import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { hasNode } from '../../shared/graph';
import { deleteUserData } from '../core/privacy';
import { getHomeConfig, isHomeMode, MAX_HOME_EXITS, MIN_HOME_EXITS, saveHomeConfig } from '../core/net';
import type { HomeMode } from '../core/net';

export const forms = new Hono();

type HomeSetupValues = { mode?: unknown; exits?: unknown };

const SAVED: Record<HomeMode, (sub: string) => string> = {
  off: () => 'Saved. Daily journeys use the global map',
  end: (s) => `Saved. Daily journeys now end at r/${s}`,
  start: (s) => `Saved. Daily journeys now start at r/${s}`,
  alternate: (s) => `Saved. Daily journeys alternate between ending and starting at r/${s}`,
};

forms.post('/home-setup', async (c) => {
  const values = await c.req.json<HomeSetupValues>();
  const home = await getHomeConfig();
  if (!home) return c.json<UiResponse>({ showToast: 'Open this from a subreddit' }, 400);

  // Select fields arrive as string[] even when single-choice.
  const picked: unknown = Array.isArray(values.mode) ? values.mode[0] : values.mode;
  const mode: HomeMode = isHomeMode(picked) ? picked : 'off';
  const exits = Array.isArray(values.exits)
    ? [...new Set(values.exits.filter((x): x is string => typeof x === 'string' && hasNode(x)))]
    : home.exits;

  if (!home.onMap && mode !== 'off' && (exits.length < MIN_HOME_EXITS || exits.length > MAX_HOME_EXITS)) {
    return c.json<UiResponse>({
      showToast: `Pick ${MIN_HOME_EXITS}–${MAX_HOME_EXITS} communities (you picked ${exits.length})`,
    });
  }
  await saveHomeConfig(mode, exits);
  return c.json<UiResponse>({ showToast: { text: SAVED[mode](home.sub), appearance: 'success' } });
});

forms.post('/delete-my-data', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json<UiResponse>({ showToast: 'Log in first' }, 400);
  try {
    await deleteUserData(username);
    return c.json<UiResponse>({ showToast: { text: 'Your Subhop data is deleted', appearance: 'success' } });
  } catch (error) {
    console.error('delete-my-data failed', error);
    return c.json<UiResponse>({ showToast: 'Couldn’t delete your data. Try again' }, 400);
  }
});
