import { test, expect } from '@playwright/test';

test('Admin can register a new volunteer', async ({ page }) => {
  await page.goto('http://localhost:8081');

  await page
    .getByRole('button', { name: /Registrar/i })
    .click();

  await page
    .getByPlaceholder('Nombre completo')
    .fill('Test Volunteer Playwright');

  await page
    .getByPlaceholder('Comunidad (ej. Zapopan)')
    .fill('Zapopan');

  await page
    .getByRole('button', { name: 'Guardar' })
    .click();

  await expect(
    page.getByText('Test Volunteer Playwright')
  ).toBeVisible();
});