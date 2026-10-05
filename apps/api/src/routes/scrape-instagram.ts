import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prisma } from "@scraping-app/db";
import {
  ScrapeInstagramInputSchema,
  ScrapeEventResponseSchema,
  generateEventId,
  mapInputTypeToEventType,
  ScrapeEventType,
} from "@scraping-app/shared";
import { apiKeyAuth } from "../middleware/auth.js";
import { getTemporalClient, taskQueue } from "../lib/temporal.js";

const SCRAPE_EVENT_WORKFLOW_NAME = "scrapeEventWorkflow";

export const scrapeInstagramRoute = new Hono()
  .use("*", apiKeyAuth)
  .post(
    "/",
    zValidator("json", ScrapeInstagramInputSchema),
    async (c) => {
      const input = c.req.valid("json");
      const user = c.get("user");
      const apiKey = c.get("apiKey");

      // Derive event type from input
      const eventType = mapInputTypeToEventType("instagram", input.type);
      const eventId = generateEventId();

      // Build payload for workflow
      const payload = {
        instagramPostUrl: input.url,
      };

      // Create ScrapeEvent record
      await prisma.scrapeEvent.create({
        data: {
          eventId,
          type: eventType,
          userId: user.id,
          payload: payload as any,
          status: "PENDING",
          webhookUrl: apiKey.user?.webhooks?.[0]?.url ?? null,
          webhookSecret: apiKey.user?.webhooks?.[0]?.secret ?? null,
        },
      });

      // Dispatch to Temporal (fire-and-forget)
      try {
        const client = await getTemporalClient();
        await client.workflow.start(SCRAPE_EVENT_WORKFLOW_NAME, {
          args: [{ eventId }],
          taskQueue: taskQueue(),
          workflowId: `scrape-${eventId}`,
          retry: { maximumAttempts: 1 },
        });
      } catch (err) {
        console.error("[api] temporal dispatch failed:", err);
        // Mark event as failed but still return 202 - workflow will retry via reconcile
        await prisma.scrapeEvent.update({
          where: { eventId },
          data: { status: "FAILED", error: "Temporal unavailable" },
        });
      }

      return c.json(
        { success: true, eventId, status: "PENDING" },
        202
      );
    }
  );