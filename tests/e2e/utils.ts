import { APIRequestContext } from '@playwright/test';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  apiKey: string;
}

/**
 * Create a test user and API key directly in the database
 * Useful for setting up test data before tests run
 */
export async function createTestUser(prisma: any): Promise<TestUser> {
  const { createHash } = await import('crypto');
  
  const plainKey = 'apk_test' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  
  const keyHash = createHash('sha256').update(plainKey).digest('hex');
  const prefix = plainKey.slice(0, 8);

  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      name: 'Test User',
    },
  });

  const apiKey = await prisma.apiKey.create({
    data: {
      keyHash,
      prefix,
      userId: user.id,
      name: 'Test Key',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    apiKey: plainKey,
  };
}

/**
 * Create a tracked target for testing
 */
export async function createTestTarget(prisma: any, userId: string, handle: string = 'testuser') {
  return prisma.trackedTarget.create({
    data: {
      platform: 'instagram',
      handle,
      profileUrl: `https://www.instagram.com/${handle}/`,
      userId,
      isActive: true,
    },
  });
}

/**
 * Clean up test data after tests
 */
export async function cleanupTestData(prisma: any, userId: string) {
  await prisma.apiKey.deleteMany({ where: { userId } });
  await prisma.trackedTarget.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

/**
 * Wait for Temporal workflow to complete
 */
export async function waitForWorkflow(
  temporalClient: any,
  workflowId: string,
  timeoutMs: number = 60000
): Promise<any> {
  const handle = temporalClient.workflow.getHandle(workflowId);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const desc = await handle.describe();
      if (desc.status.name === 'WORKFLOW_EXECUTION_STATUS_COMPLETED') {
        return { success: true, result: await handle.result() };
      }
      if (desc.status.name === 'WORKFLOW_EXECUTION_STATUS_FAILED') {
        return { success: false, error: desc.failure?.message };
      }
      if (desc.status.name === 'WORKFLOW_EXECUTION_STATUS_TIMED_OUT') {
        return { success: false, error: 'Workflow timed out' };
      }
    } catch (e) {
      // Workflow not found yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  
  throw new Error(`Workflow ${workflowId} did not complete within ${timeoutMs}ms`);
}

/**
 * Make authenticated API request
 */
export async function authenticatedRequest(
  request: any,
  apiKey: string,
  method: string,
  path: string,
  data?: any
) {
  return request[method.toLowerCase()](path, {
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    data,
  });
}

/**
 * Create scrape event via API
 */
export async function createScrapeEvent(
  request: any,
  apiKey: string,
  input: {
    type: 'instagram' | 'threads';
    url: string;
    scrapeLikes?: boolean;
    scrapeCommentNumber?: boolean;
    scrapeViews?: boolean;
    scrapeComments?: boolean;
    maxComments?: number;
  }
) {
  const endpoint = input.type === 'instagram' 
    ? '/scrape/instagram' 
    : '/scrape/threads';
  
  return request.post(endpoint, {
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    data: {
      type: input.url.includes('/reel/') ? 'REEL' : 'POST',
      url: input.url,
      scrapeLikes: input.scrapeLikes ?? true,
      scrapeCommentNumber: input.scrapeCommentNumber ?? true,
      scrapeViews: input.scrapeViews ?? false,
      scrapeComments: input.scrapeComments ?? false,
      maxComments: input.maxComments ?? 0,
    },
  });
}