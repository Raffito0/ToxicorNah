import { test, expect } from '@playwright/test';

const CHAT_IMAGE = 'public/f39bace59c9e20e9a8af55c4cd6634ea.jpg';

test('full analysis flow', async ({ page }) => {
  await page.goto('/');

  // Upload chat screenshot
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(CHAT_IMAGE);

  // Confirm the crop modal
  await page.locator('text=Confirm 1 chat').click();

  // Verify image uploaded
  await expect(page.locator('text=1 chat uploaded')).toBeVisible({ timeout: 5000 });

  // Click READ HIM
  await page.locator('text=READ HIM').click();

  // Wait for analysis to complete (Gemini can take 15-30s)
  await expect(page.locator('text=TOXICITY SCORE')).toBeVisible({ timeout: 60000 });

  // Verify key sections are present
  await expect(page.locator('text=His Soul Type')).toBeVisible();
  await expect(page.locator('text=WHO HE IS')).toBeVisible();
});
