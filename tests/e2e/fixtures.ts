import { test as base, APIRequestContext } from '@playwright/test';

interface TestFixtures {
  apiRequest: APIRequestContext;
  apiKey: string;
  createdKeyId: string;
}

export const test = base.extend<TestFixtures>({
  apiRequest: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({
      baseURL: 'http://localhost:3001',
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
    await use(request);
    await request.dispose();
  },

  apiKey: async ({ apiRequest }, use) => {
    // Use existing test API key from .env
    const key = process.env.TEST_API_KEY || 'apk_test123456789012345678901234';
    await use(key);
  },

  createdKeyId: ['', { option: true }], // Will be set by tests
});

export { expect } from '@playwright/test';