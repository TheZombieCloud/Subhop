import { Hono, type Context } from 'hono';
import { telemetry } from '@devvit/analytics/server/reddit';
import type { Puzzle, Run } from '../../shared/api';
import { hopsLeft } from '../../shared/rules';

/*
 * Devvit Journeys: one journey per play of a puzzle.
 *
 *   App.Ready           client, when the game screen is interactive
 *   Journey.Start       client, when the player taps "Start the journey"
 *   Journey.Progress    server, after each validated hop (how much closer you are, 0–0.95)
 *   Journey.Interaction client, for step back, share, leaderboard, stats, propose, vote
 *   Journey.End         server, on arrival (complete, win, score = hops) or give up
 *
 * Progress and End fire from the server, because only the server knows a hop was legal.
 * The client sends its journey id in the x-devvit-journey-id header.
 * Telemetry must never break play, so every call swallows its own errors.
 */

const safely = async (what: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    console.warn(`telemetry ${what} failed`, error);
  }
};

const journeyIdOf = (c: Context) => c.req.header('x-devvit-journey-id') ?? '';

export const trackHop = (c: Context, puzzle: Puzzle, run: Run) => {
  const journeyId = journeyIdOf(c);
  if (!journeyId) return Promise.resolve();
  if (run.status === 'finished') {
    return safely('end', () => telemetry.endJourney({ journeyId, complete: true, game: { win: true, score: run.hops } }));
  }
  const left = hopsLeft(puzzle, run.path);
  const progress = Math.min(0.95, Math.max(0, 1 - left / Math.max(1, puzzle.par)));
  return safely('progress', () =>
    telemetry.journeyProgress({
      journeyId,
      progress,
      action: 'hop',
      // Which puzzle, which hop, and whether it got closer: "2026-11-18 hop_2 wrong".
      actionDetails: `${puzzle.id} hop_${run.hops} ${run.moves?.endsWith('c') ? 'closer' : 'wrong'}`,
    })
  );
};

export const trackGiveUp = (c: Context, run: Run) => {
  const journeyId = journeyIdOf(c);
  if (!journeyId) return Promise.resolve();
  return safely('end', () => telemetry.endJourney({ journeyId, complete: false, game: { win: false, score: run.hops } }));
};

const unrecorded = { receipt: { status: 'JOURNEY_RECEIPT_UNSPECIFIED', message: 'Not recorded' } };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 64) : '');

/**
 * The endpoints @devvit/analytics/client/reddit posts to (its own router is Express;
 * this app is Hono). Mounted at /api/telemetry.
 */
export const journeyRoutes = new Hono();

journeyRoutes.post('/journey/start', async (c) => {
  try {
    return c.json(await telemetry.startJourney());
  } catch (error) {
    console.warn('telemetry start failed', error);
    return c.json({ journeyId: '', ...unrecorded });
  }
});

journeyRoutes.post('/journey/app-ready', async (c) => {
  try {
    return c.json(await telemetry.appReady());
  } catch (error) {
    console.warn('telemetry app-ready failed', error);
    return c.json(unrecorded);
  }
});

journeyRoutes.post('/journey/interaction', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const field = (k: string) => (typeof body === 'object' && body !== null && k in body ? text(Reflect.get(body, k)) : '');
  const action = field('action');
  if (!action) return c.json({ error: 'action is required.', ...unrecorded }, 400);
  try {
    return c.json(
      await telemetry.journeyInteraction({ journeyId: field('journeyId'), action, actionDetails: field('actionDetails') })
    );
  } catch (error) {
    console.warn('telemetry interaction failed', error);
    return c.json(unrecorded);
  }
});
