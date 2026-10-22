import { test, expect } from '@playwright/test';

test('stock page reaches a terminal state after search', async ({ page }) => {
  await page.goto('/stock');

  await page.fill('input[name="ticker"]', 'RELIANCE');
  await page.click('button:has-text("Analyse")');

  await expect(page).toHaveURL(/[?&]q=RELIANCE/);
  await expect(
    page.locator('[data-testid="company"]').locator('text=/₹|N\\/A|not found|failed|retry/i').first()
  ).toBeVisible({ timeout: 15000 });
});

test('legacy fundamentals and analysis routes redirect to the stock page', async ({ page }) => {
  await page.goto('/fundamentals');
  await expect(page).toHaveURL(/\/stock$/);
  await page.goto('/analysis');
  await expect(page).toHaveURL(/\/stock$/);
});
