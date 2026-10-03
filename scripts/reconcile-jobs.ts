/**
 * Reconciles ScrapeJob rows against Temporal so a dead workflow can never be
 * left showing as RUNNING/QUEUED forever.
 *
 * For each non-terminal job, ask Temporal whether its workflow is still open.
 * If Temporal has no execution (or it already closed), mark the row FAILED.
 *
 * Usage:  bun run scripts/reconcile-jobs.ts
 */
import { Connection, Client } from "@temporalio/client";
import { prisma } from "@scraping-app/db";

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";

/** Workflow statuses that mean "still alive, don't touch". */
const OPEN_STATUSES = new Set(["WORKFLOW_EXECUTION_STATUS_RUNNING"]);

async function main() {
  const jobs = await prisma.scrapeJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: {
      id: true,
      status: true,
      temporalWorkflowId: true,
      attemptCount: true,
    },
  });

  if (jobs.length === 0) {
    console.log("[reconcile] no QUEUED/RUNNING jobs — nothing to do");
    return;
  }

  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  let fixed = 0;
  for (const job of jobs) {
    let alive = false;

    if (job.temporalWorkflowId) {
      const desc = client.workflow.getHandle(job.temporalWorkflowId);
      try {
        const info = await desc.describe();
        alive = OPEN_STATUSES.has(info.status.name as never);
      } catch {
        alive = false; // execution not found
      }
    }

    if (alive) {
      console.log(`[reconcile] ${job.id} still ${job.status} in Temporal — leaving alone`);
      continue;
    }

    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: "Workflow no longer exists in Temporal (worker was down or workflow crashed). Retry to start a new run.",
      },
    });
    fixed++;
    console.log(`[reconcile] ${job.id} orphaned (${job.status}) -> FAILED`);
  }

  await connection.close();
  console.log(`[reconcile] done — ${fixed} orphaned job(s) fixed`);
}

main()
  .catch((err) => {
    console.error("[reconcile] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());