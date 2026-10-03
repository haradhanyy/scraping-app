import {
  ApplicationFailure,
  proxyActivities,
  log,
  sleep,
} from "@temporalio/workflow";
import type * as activities from "../activities/event-activities.js";

const {
  loadEventActivity,
  markEventRunningActivity,
  runScraperEventActivity,
  saveEventResultActivity,
  markEventCompletedActivity,
  markEventFailedActivity,
  fireWebhookActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "60 seconds",
  retry: { maximumAttempts: 2, backoffCoefficient: 2.0 },
});

const runScraperNoRetry = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "60 seconds",
  retry: { maximumAttempts: 1 },
});

export interface ScrapeEventWorkflowInput {
  eventId: string;
}

/**
 * Event-driven scraping workflow:
 * - Loads ScrapeEvent record
 * - Runs scraper with proxy rotation
 * - Saves result to persistent Post/Comment/MetricSnapshot models
 * - Fires webhook on completion/failure
 */
export async function scrapeEventWorkflow({ eventId }: ScrapeEventWorkflowInput): Promise<void> {
  let eventType = "";
  let webhookUrl: string | undefined;
  let webhookSecret: string | undefined;

  try {
    // Load event
    const event = await loadEventActivity({ eventId });
    eventType = event.type;
    webhookUrl = event.webhookUrl ?? undefined;
    webhookSecret = event.webhookSecret ?? undefined;

    await markEventRunningActivity({ eventId });

    const MAX_ATTEMPTS = 4;
    const BACKOFFS = ["5 seconds", "20 seconds", "60 seconds"];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        log.info(`scrape event attempt ${attempt}/${MAX_ATTEMPTS}`, { eventId, type: eventType });

        const result = await runScraperNoRetry.runScraperEventActivity({ eventId });
        await saveEventResultActivity({ eventId, result });
        await markEventCompletedActivity({ eventId, result });

        // Fire webhook if configured
        if (webhookUrl) {
          await fireWebhookActivity({
            webhookUrl,
            webhookSecret,
            payload: {
              eventId,
              type: eventType,
              status: "COMPLETED",
              result,
              completedAt: new Date().toISOString(),
            },
          });
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const rateLimited =
          err instanceof ApplicationFailure
            ? err.type === "RateLimitedError"
            : /rate.?limit|login wall|429|challenge/i.test(msg);

        log.warn(`event attempt ${attempt} failed (rateLimited=${rateLimited}): ${msg}`, { eventId });

        if (attempt >= MAX_ATTEMPTS) {
          await markEventFailedActivity({ eventId, error: `Failed after ${attempt} attempts: ${msg}`, rateLimited });

          if (webhookUrl) {
            await fireWebhookActivity({
              webhookUrl,
              webhookSecret,
              payload: {
                eventId,
                type: eventType,
                status: rateLimited ? "RATE_LIMITED" : "FAILED",
                error: msg,
                completedAt: new Date().toISOString(),
              },
            });
          }
          return;
        }
        const backoff = rateLimited ? "2 minutes" : BACKOFFS[attempt - 1] ?? "60 seconds";
        await sleep(backoff);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`event workflow failed outside retry loop: ${msg}`, { eventId });
    const rateLimited = /rate.?limit|login wall|429|challenge/i.test(msg);
    try {
      await markEventFailedActivity({
        eventId,
        error: `Workflow error: ${msg}`.slice(0, 4000),
        rateLimited,
      });
      if (webhookUrl) {
        await fireWebhookActivity({
          webhookUrl,
          webhookSecret,
          payload: {
            eventId,
            type: eventType,
            status: rateLimited ? "RATE_LIMITED" : "FAILED",
            error: msg,
            completedAt: new Date().toISOString(),
          },
        });
      }
    } catch (persistErr) {
      log.error(
        `could not persist failure for event ${eventId}: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
        { eventId },
      );
    }
    throw err;
  }
}