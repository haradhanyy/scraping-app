import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prisma } from "@scraping-app/db";
import { createHash } from "crypto";
import { apiKeyAuth } from "../middleware/auth.js";
import { z } from "zod";

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

const ApiKeyIdParamSchema = z.object({
  id: z.string().cuid(),
});

function generateApiKey(): string {
  const prefix = "apk_";
  const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return prefix + randomPart;
}

/** Get the display prefix (first 12 chars: apk_ + 8 hex chars) */
function getKeyPrefix(key: string): string {
  return key.slice(0, 12);
}

export const apiKeysRoute = new Hono()
  .use("*", apiKeyAuth)
  // GET /api/v1/api-keys — List user's API keys (without showing the key)
  .get("/", async (c) => {
    const user = c.get("user");
    const keys = await prisma.apiKey.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        isActive: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return c.json(keys);
  })
  // POST /api/v1/api-keys — Create new API key (returns plaintext ONCE)
  .post("/", zValidator("json", CreateApiKeySchema), async (c) => {
    const user = c.get("user");
    const input = c.req.valid("json");

    const plainKey = generateApiKey();
    const keyHash = createHash("sha256").update(plainKey).digest("hex");
    const prefix = getKeyPrefix(plainKey);

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = await prisma.apiKey.create({
      data: {
        keyHash,
        prefix,
        userId: user.id,
        name: input.name,
        expiresAt,
      },
    });

    // Return plaintext key ONLY ONCE
    return c.json(
      {
        ...apiKey,
        key: plainKey, // Only returned once!
      },
      201
    );
  })
  // DELETE /api/v1/api-keys/:id — Revoke API key
  .delete("/:id", zValidator("param", ApiKeyIdParamSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");

    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.userId !== user.id) {
      return c.json({ error: "API Key not found" }, 404);
    }

    await prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    return c.json({ ok: true });
  });