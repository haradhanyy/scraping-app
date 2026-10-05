import { test, expect } from './fixtures';

test.describe('API Key Management API', () => {
  test('GET /api/v1/api-keys returns empty list initially', async ({ apiRequest, apiKey }) => {
    const response = await apiRequest.get('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
    });
    expect(response.ok()).toBeTruthy();
    const keys = await response.json();
    expect(Array.isArray(keys)).toBeTruthy();
  });

  test('POST /api/v1/api-keys creates new key and returns plaintext once', async ({ apiRequest, apiKey }) => {
    const response = await apiRequest.post('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
      data: {
        name: 'E2E Test Key',
        expiresInDays: 30,
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('key');
    expect(data.key).toMatch(/^apk_[a-f0-9]{48}$/);
    expect(data).toHaveProperty('prefix', data.key.slice(0, 12));
    expect(data).toHaveProperty('name', 'E2E Test Key');
    expect(data.isActive).toBe(true);
  });

  test('GET /api/v1/api-keys returns created key in list (without full key)', async ({ apiRequest, apiKey }) => {
    // Create a key first
    const createResponse = await apiRequest.post('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
      data: { name: 'List Test Key', expiresInDays: 7 },
    });
    const created = await createResponse.json();

    // List keys
    const listResponse = await apiRequest.get('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
    });
    expect(listResponse.ok()).toBeTruthy();
    const keys = await listResponse.json();
    expect(Array.isArray(keys)).toBeTruthy();
    
    const found = keys.find((k: any) => k.id === created.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('List Test Key');
    expect(found.prefix).toBe(created.prefix);
    expect(found).not.toHaveProperty('key'); // Full key not in list
  });

  test('DELETE /api/v1/api-keys/:id revokes key', async ({ apiRequest, apiKey }) => {
    // Create a key to delete
    const createResponse = await apiRequest.post('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
      data: { name: 'Delete Me', expiresInDays: 1 },
    });
    const created = await createResponse.json();

    // Delete it
    const deleteResponse = await apiRequest.delete(`/api/v1/api-keys/${created.id}`, {
      headers: { Authorization: apiKey },
    });
    expect(deleteResponse.ok()).toBeTruthy();

    // Verify it's revoked (not in list)
    const listResponse = await apiRequest.get('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
    });
    const keys = await listResponse.json();
    const found = keys.find((k: any) => k.id === created.id);
    expect(found).toBeUndefined(); // Should be gone from list
  });

  test('POST /api/v1/api-keys validates input', async ({ apiRequest, apiKey }) => {
    // Missing name
    const response = await apiRequest.post('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
      data: { expiresInDays: 30 },
    });
    expect(response.status()).toBe(400);

    // Invalid expiry
    const response2 = await apiRequest.post('/api/v1/api-keys', {
      headers: { Authorization: apiKey },
      data: { name: 'Test', expiresInDays: -1 },
    });
    expect(response2.status()).toBe(400);
  });

  test('API key auth rejects invalid keys', async ({ apiRequest }) => {
    const response = await apiRequest.get('/api/v1/api-keys', {
      headers: { Authorization: 'apk_invalidkey123' },
    });
    expect(response.status()).toBe(401);

    const response2 = await apiRequest.get('/api/v1/api-keys', {
      headers: { Authorization: 'Bearer invalid' },
    });
    expect(response2.status()).toBe(401);

    const response3 = await apiRequest.get('/api/v1/api-keys');
    expect(response3.status()).toBe(401);
  });
});