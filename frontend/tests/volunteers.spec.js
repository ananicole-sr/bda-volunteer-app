import { test, expect } from '@playwright/test';

test('Admin can view volunteers', async ({ page }) => {
  await page.goto('http://localhost:8081/admin');

  await expect(
    page.getByText('Sofía Ramírez')
  ).toBeVisible();

  await expect(
    page.getByText('Carlos Mendoza')
  ).toBeVisible();

  await expect(
    page.getByText('Valeria Ríos')
  ).toBeVisible();
});