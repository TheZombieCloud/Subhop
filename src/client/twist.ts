import type { Puzzle, Twist } from '../shared/api';

/** Kicker above the route: whose journey it is and which way home lies. */
export const journeyLabel = (p: Pick<Puzzle, 'home' | 'by'>): string => {
  const base = p.home === 'end' ? 'Today’s journey home' : p.home === 'start' ? 'Today’s journey from home' : 'Today’s journey';
  return p.by ? `${base} · picked by u/${p.by}` : base;
};

/** `stamp` is the text on the notice stamp; `rule` explains it in a sentence. */
export type TwistInfo = { stamp: string; name: string; rule: string };

export const twistInfo = (t: Twist): TwistInfo => {
  switch (t.kind) {
    case 'avoid':
      return { stamp: 'Border closed', name: 'Roadblock', rule: `r/${t.sub} is closed today. Find another way in.` };
    case 'via':
      return { stamp: 'Detour', name: 'Detour', rule: `Your route must pass through r/${t.sub}.` };
    case 'noback':
      return { stamp: 'No return', name: 'No return', rule: 'No stepping back today. Every hop is final.' };
  }
};

export const compact = (n: number): string => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
