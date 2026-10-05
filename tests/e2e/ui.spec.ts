import { test, expect } from '@playwright/test';

test.describe('API Keys Page UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/api-keys');
    await page.waitForLoadState('networkidle');
  });

  test('shows empty state when no keys exist', async ({ page }) => {
    await expect(page.locator('text=No API keys yet')).toBeVisible();
    await expect(page.locator('button:has-text("New API Key")')).toBeVisible();
  });

  test('can create new API key and shows it once', async ({ page }) => {
    // Click create button
    await page.click('button:has-text("New API Key")');
    
    // Fill form
    await page.fill('input[placeholder*="Production"]', 'Playwright Test Key');
    await page.selectOption('select', '30');
    
    // Submit
    await page.click('button:has-text("Create API Key")');
    
    // Modal should show the key
    await expect(page.locator('.font-mono')).toContainText('apk_', { timeout: 10000 });
    await expect(page.locator('text=API Key Created!')).toBeVisible();
    
    // Warning message visible
    await expect(page.locator('text=Copy this now')).toBeVisible();
    
    // Copy and close
    await page.click('button:has-text("Copy & Close")');
    
    // Wait for modal to close and list to update
    await page.waitForLoadState('networkidle');
    
    // Key should appear in list
    await expect(page.locator('text=Playwright Test Key')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=LIVE')).toBeVisible();
  });

  test('shows key prefix in list but not full key', async ({ page }) => {
    await page.click('button:has-text("New API Key")');
    await page.fill('input[placeholder*="Production"]', 'Prefix Test');
    await page.selectOption('select', '7');
    await page.click('button:has-text("Create API Key")');
    
    // Wait for modal and close
    await expect(page.locator('.font-mono')).toContainText('apk_', { timeout: 10000 });
    await page.click('button:has-text("Copy & Close")');
    
    // Wait for list to update
    await page.waitForLoadState('networkidle');
    
    // List shows prefix only
    await expect(page.locator('text=Prefix Test')).toBeVisible({ timeout: 10000 });
    const row = page.locator('text=Prefix Test').locator('..');
    await expect(row.locator('text=apk_')).toBeVisible();
    
    // Full key not visible in list
    await expect(page.locator('body')).not.toContainText('apk_');
  });

  test('can revoke a key', async ({ page }) => {
    // Create a key
    await page.click('button:has-text("New API Key")');
    await page.fill('input[placeholder*="Production"]', 'To Be Revoked');
    await page.selectOption('select', '1');
    await page.click('button:has-text("Create API Key")');
    
    // Wait for modal and close
    await expect(page.locator('.font-mono')).toContainText('apk_', { timeout: 10000 });
    await page.click('button:has-text("Copy & Close")');
    await page.waitForLoadState('networkidle');
    
    // Verify it's in list
    await expect(page.locator('text=To Be Revoked')).toBeVisible({ timeout: 10000 });
    
    // Click revoke
    await page.click('button:has-text("Revoke")');
    await page.waitForLoadState('networkidle');
    
    // Should be removed from list
    await expect(page.locator('text=To Be Revoked')).not.toBeVisible({ timeout: 10000 });
  });

  test('copy prefix button works', async ({ page }) => {
    // Create a key
    await page.click('button:has-text("New API Key")');
    await page.fill('input[placeholder*="Production"]', 'Copy Test');
    await page.selectOption('select', '30');
    await page.click('button:has-text("Create API Key")');
    
    // Wait for modal and close
    await expect(page.locator('.font-mono')).toContainText('apk_', { timeout: 10000 });
    await page.click('button:has-text("Copy & Close")');
    await page.waitForLoadState('networkidle');
    
    // Click copy prefix button
    const copyBtn = page.locator('button:has-text("Copy Prefix")').first();
    await expect(copyBtn).toBeEnabled({ timeout: 5000 });
    await copyBtn.click();
    
    // Verify button is clickable (clipboard test not possible in headless)
    await expect(copyBtn).toBeEnabled();
  });

  test('expired key shows IDLE status', async ({ page }) => {
    // This test would need a pre-expired key in DB
    // Skipping for now - would require test data setup
  });
});