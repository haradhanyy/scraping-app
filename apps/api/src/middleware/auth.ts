import { createMiddleware } from "hono/factory";
import { prisma } from "@scraping-app/db";
import { isValidApiKeyFormat } from "@scraping-app/shared";
import { createHash } from "crypto";

declare module "hono" {
  interface ContextVariableMap {
    user: { id: string; email: string; name?: string | null; webhooks: Array<{ url: string; secret?: string | null; isActive: boolean }> };
    apiKey: { id: string; userId: string; user?: { id: string; email: string; webhooks: Array<{ url: string; secret?: string | null; isActive: boolean }> } };
  }
}

/**
 * Middleware to validate `Authorization: apk_<key>` header.
 * Attaches `user` and `apiKey` to context on success.
 * Returns 401 if invalid/expired/missing.
 */
export const apiKeyAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader || !isValidApiKeyFormat(authHeader)) {
    return c.json({ error: "API Key required (format: apk_...)" }, 401);
  }

  const keyHash = createHash("sha256").update(authHeader).digest("hex");

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: { include: { webhooks: { where: { isActive: true } } } } },
  });

  if (!apiKey || !apiKey.isActive) {
    return c.json({ error: "API Key invalid or revoked" }, 401);
  }

  if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
    return c.json({ error: "API Key expired" }, 401);
  }

  // Update lastUsedAt asynchronously (don't block)
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  c.set("user", apiKey.user!);
  c.set("apiKey", apiKey);
  await next();
});