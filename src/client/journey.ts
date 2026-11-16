import { telemetry } from '@devvit/analytics/client/reddit';

// Devvit Journeys from the client (see src/server/core/journey.ts for the whole map).
// Telemetry never blocks or breaks play: every call is fire-and-forget.

const quietly = (p: Promise<unknown>) => void p.catch(() => undefined);

export const appReady = () => quietly(telemetry.appReady());

/** Journey.Start, on an explicit tap. Reuses the active journey if there is one. */
export const startJourney = async (): Promise<void> => {
  await telemetry.startJourney().catch(() => undefined);
};

/** Journey.Interaction for a committed tap. */
export const interact = (action: string, actionDetails?: string) =>
  quietly(telemetry.interaction(actionDetails ? { action, actionDetails } : { action }));

/** The server ends the journey; forget it here so the next play starts fresh. */
export const journeyEnded = () => telemetry.clearJourneyId();

/** Sent with hops so the server can attach Progress and End to this journey. */
export const journeyHeaders = (): Record<string, string> => {
  const id = telemetry.getActiveJourneyId();
  return id ? { 'x-devvit-journey-id': id } : {};
};
