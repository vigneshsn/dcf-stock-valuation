import { test, expect } from '@playwright/test';

test('fundamentals page reaches a terminal state after search', async ({ page }) => {
  await page.goto('/fundamentals');

  await page.fill('input[name="ticker"]', 'RELIANCE.NS');
  await page.click('button:has-text("Search")');

  await expect(
    page.locator('text=/N\\/A|not found|failed|retry/i').first()
  ).toBeVisible({ timeout: 15000 });
});
