import { context, reddit, redis } from '@devvit/web/server';
import { canonicalName } from '../../shared/graph';
import { isHomeMode, MAX_HOME_EXITS, MIN_HOME_EXITS, parseExits } from '../../shared/rules';
import type { HomeConfig, HomeMode } from '../../shared/rules';

export * from '../../shared/rules';

/*
 * Per-installation home config. The rules themselves live in src/shared/rules.ts.
 *
 *   home:config   hash   mode off|end|start|alternate, exits JSON string[]
 *                        (older installs stored enabled "1"|"0", read as end|off)
 */

/** This installation's community and where it sits in daily journeys. */
export const getHomeConfig = async (): Promise<HomeConfig | null> => {
  const name = context.subredditName;
  if (!name) return null;
  const onMap = canonicalName(name);
  const stored = await redis.hGetAll('home:config');
  const mode: HomeMode = isHomeMode(stored.mode) ? stored.mode : stored.enabled === '1' ? 'end' : 'off';
  return {
    sub: onMap ?? name,
    onMap: onMap !== null,
    mode,
    exits: onMap ? [] : parseExits(stored.exits).slice(0, MAX_HOME_EXITS),
  };
};

export const saveHomeConfig = async (mode: HomeMode, exits: string[]): Promise<void> => {
  await redis.hSet('home:config', { mode, exits: JSON.stringify(exits) });
  await redis.hDel('home:config', ['enabled']);
};

/** The home config, but only if it's switched on and usable. */
export const activeHome = async (): Promise<HomeConfig | null> => {
  const h = await getHomeConfig();
  if (!h || h.mode === 'off') return null;
  if (!h.onMap && h.exits.length < MIN_HOME_EXITS) return null;
  return h;
};

/**
 * Communities this sub's own mods list as related in its sidebar ("Related communities"
 * widgets), limited to ones on the Subhop map. Used to pre-fill the home setup form.
 */
export const sidebarRelated = async (sub: string): Promise<string[]> => {
  try {
    const widgets = await reddit.getWidgets(sub);
    const names: string[] = [];
    for (const w of widgets) {
      if (!('communities' in w) || !Array.isArray(w.communities)) continue;
      for (const c of w.communities) {
        const raw: unknown = typeof c === 'object' && c !== null && 'name' in c ? c.name : null;
        const name = typeof raw === 'string' ? canonicalName(raw.replace(/^r\//i, '')) : null;
        if (name && name !== sub && !names.includes(name)) names.push(name);
      }
    }
    return names;
  } catch (err) {
    console.warn(`sidebar widgets for r/${sub} failed`, err);
    return [];
  }
};
