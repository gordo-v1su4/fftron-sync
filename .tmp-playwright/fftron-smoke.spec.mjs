import { test, expect } from '@playwright/test';

test('loads fftron shell', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.getByText('FFTRON Sync Console')).toBeVisible();
});
