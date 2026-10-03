/**
 * Reconciles ScrapeEvent rows against Temporal.
 * Marks orphans as FAILED and fires failure webhook.
 * Usage: bun run scripts/reconcile-events.ts
 */
import { Connection, Client } from "@temporalio/client";
import { prisma } from "@scraping-app/db";

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";

const OPEN_STATUSES = new Set(["WORKFLOW_EXECUTION_STATUS_RUNNING"]);

async function fireFailureWebhook(event: { webhookUrl: string | null; webhookSecret: string | null; eventId: string; type: string; error: string | null }) {
  if (!event.webhookUrl) return;
  try {
    const payload = {
      eventId: event.eventId,
      type: event.type,
      status: "FAILED",
      error: event.error,
      completedAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (event.webhookSecret) {
      const { createHash } = await import("crypto");
      const signature = createHash("sha256").update(event.webhookSecret + body).digest("hex");
      headers["X-Signature"] = `sha256=${signature}`;
    }
    await fetch(event.webhookUrl, { method: "POST", headers, body });
  } catch {}
}

async function main() {
  const events = await prisma.scrapeEvent.findMany({
    where: { status: { in: ["PENDING", "RUNNING"] } },
    select: { eventId: true, status: true, type: true, webhookUrl: true, webhookSecret: true, error: true },
  });

  if (events.length === 0) {
    console.log("[reconcile] no PENDING/RUNNING events — nothing to do");
    return;
  }

  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  let fixed = 0;
  for (const event of events) {
    let alive = false;

    try {
      const handle = client.workflow.getHandle(`scrape-${event.eventId}`);
      const info = await handle.describe();
      alive = OPEN_STATUSES.has(info.status.name as never);
    } catch {
      alive = false;
    }

    if (alive) {
      console.log(`[reconcile] ${event.eventId} still ${event.status} in Temporal — leaving alone`);
      continue;
    }

    await prisma.scrapeEvent.update({
      where: { eventId: event.eventId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: "Workflow no longer exists in Temporal (worker was down or workflow crashed)",
      },
    });

    await fireFailureWebhook(event);
    fixed++;
    console.log(`[reconcile] ${event.eventId} orphaned (${event.status}) -> FAILED`);
  }

  await connection.close();
  console.log(`[reconcile] done — ${fixed} orphaned event(s) fixed`);
}

main()
  .catch((err) => {
    console.error("[reconcile] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());