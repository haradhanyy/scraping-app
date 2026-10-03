import { prisma } from "@scraping-app/db";
import { ProxyConfig, ProxyConfigSchema } from "@scraping-app/shared";

/** In-memory cache of healthy proxies */
const proxyCache = new Map<string, ProxyConfig>();
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 60_000; // 1 minute

/** Select a proxy using weighted round-robin (weight = successRate / latency) */
function selectProxy(proxies: ProxyConfig[]): ProxyConfig | null {
  if (proxies.length === 0) return null;

  // Filter healthy proxies (successRate > 0.5, latency < 30s)
  const healthy = proxies.filter(
    (p) => (p.successRate ?? 0) > 0.5 && (p.latencyMs ?? Infinity) < 30_000
  );

  if (healthy.length === 0) return null;

  // Weight by successRate / latency
  const totalWeight = healthy.reduce(
    (sum, p) => sum + (p.successRate ?? 0.5) / Math.max(p.latencyMs ?? 5000, 100),
    0
  );
  let random = Math.random() * totalWeight;

  for (const proxy of healthy) {
    const weight = (proxy.successRate ?? 0.5) / Math.max(proxy.latencyMs ?? 5000, 100);
    random -= weight;
    if (random <= 0) return proxy;
  }

  return healthy[0];
}

/** Fetch active proxies from DB and refresh cache */
export async function refreshProxyCache(): Promise<ProxyConfig[]> {
  const proxies = await prisma.proxyConfig.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  const valid = proxies
    .map((p) => ({
      ...p,
      lastChecked: p.lastChecked?.toISOString() ?? null,
    }))
    .map((p) => ProxyConfigSchema.parse(p))
    .filter((p) => p.isActive);

  proxyCache.clear();
  for (const p of valid) {
    proxyCache.set(p.id, p);
  }

  lastHealthCheck = Date.now();
  return valid;
}

/** Get a proxy for scraping, refreshing cache if stale */
export async function getProxy(): Promise<ProxyConfig | null> {
  const now = Date.now();
  if (now - lastHealthCheck > HEALTH_CHECK_INTERVAL_MS || proxyCache.size === 0) {
    await refreshProxyCache();
  }

  const proxies = Array.from(proxyCache.values());
  const selected = selectProxy(proxies);

  if (!selected) {
    console.warn("[proxy] No healthy proxies available");
    return null;
  }

  return selected;
}

/** Record proxy health check result */
export async function recordProxyResult(
  proxyId: string,
  success: boolean,
  latencyMs: number
): Promise<void> {
  const proxy = await prisma.proxyConfig.findUnique({ where: { id: proxyId } });
  if (!proxy) return;

  const totalChecks = (proxy.successRate ?? 0.5) * 100 + 1; // approximate
  const newSuccessRate = ((proxy.successRate ?? 0.5) * totalChecks + (success ? 1 : 0)) / (totalChecks + 1);

  const now = new Date();
  await prisma.proxyConfig.update({
    where: { id: proxyId },
    data: {
      lastChecked: now,
      latencyMs,
      successRate: newSuccessRate,
    },
  });

  // Update cache
  const cached = proxyCache.get(proxyId);
  if (cached) {
    cached.lastChecked = now.toISOString();
    cached.latencyMs = latencyMs;
    cached.successRate = newSuccessRate;
  }
}