import {
  ApplicationFailure,
  proxyActivities,
  log,
  sleep,
} from "@temporalio/workflow";
import type * as activities from "./activities/activities.js";

const {
  loadJobActivity,
  markRunningActivity,
  runScraperActivity,
  savePostsActivity,
  markCompletedActivity,
  markFailedActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "60 seconds",
  retry: { maximumAttempts: 2, backoffCoefficient: 2.0 },
});

const runScraperNoRetry = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "60 seconds",
  retry: { maximumAttempts: 1 },
});

export interface ScrapeWorkflowInput {
  jobId: string;
}

/**
 * Resilient scraping workflow:
 * - up to 4 scrape attempts with exponential backoff (5s, 20s, 60s)
 * - RateLimitedError gets longer backoff + RATE_LIMITED terminal state
 * - generic errors -> FAILED with message persisted for the dashboard
 */
export async function scrapeWorkflow({ jobId }: ScrapeWorkflowInput): Promise<void> {
  try {
    await loadJobActivity({ jobId }); // fail fast on unknown id
    await markRunningActivity({ jobId });

    const MAX_ATTEMPTS = 4;
    const BACKOFFS = ["5 seconds", "20 seconds", "60 seconds"];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        log.info(`scrape attempt ${attempt}/${MAX_ATTEMPTS}`, { jobId });
        const posts = await runScraperNoRetry.runScraperActivity({ jobId });
        await savePostsActivity({ jobId, posts });
        await markCompletedActivity({ jobId });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const rateLimited =
          err instanceof ApplicationFailure
            ? err.type === "RateLimitedError"
            : /rate.?limit|login wall|429|challenge/i.test(msg);

        log.warn(`attempt ${attempt} failed (rateLimited=${rateLimited}): ${msg}`, { jobId });

        if (attempt >= MAX_ATTEMPTS) {
          await markFailedActivity({ jobId, error: `Failed after ${attempt} attempts: ${msg}`, rateLimited });
          return;
        }
        // Longer cooldown for rate limits.
        const backoff = rateLimited ? "2 minutes" : BACKOFFS[attempt - 1] ?? "60 seconds";
        await sleep(backoff);
      }
    }
  } catch (err) {
    // Anything escaping the retry loop (e.g. loadJobActivity throwing, or a
    // cancellation) must still land in the DB. Without this the job row is
    // orphaned in QUEUED/RUNNING and the dashboard shows it as alive forever.
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`workflow failed outside retry loop: ${msg}`, { jobId });
    const rateLimited = /rate.?limit|login wall|429|challenge/i.test(msg);
    try {
      await markFailedActivity({
        jobId,
        error: `Workflow error: ${msg}`.slice(0, 4000),
        rateLimited,
      });
    } catch (persistErr) {
      log.error(
        `could not persist failure for job ${jobId}: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
        { jobId },
      );
    }
    throw err;
  }
}

export { scrapeEventWorkflow } from "./workflows/event-workflow.js";
