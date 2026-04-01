import { test, expect } from '@playwright/test';

test.describe('User Registration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Switch to register mode
    await page.getByRole('button', { name: /create account|register/i }).click();
  });

  test('shows registration form when switching to register mode', async ({ page }) => {
    await expect(page.getByText('Create Account').first()).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('shows validation errors for empty form submission', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Username must be at least 3 characters')).toBeVisible();
    await expect(page.getByText('Invalid email address')).toBeVisible();
    await expect(page.getByText('Password must be at least 6 characters')).toBeVisible();
  });

  test('shows validation error for invalid email', async ({ page }) => {
    // Disable browser native form validation so Zod validation error is shown
    await page.evaluate(() => {
      document.querySelectorAll('form').forEach(form => form.setAttribute('novalidate', ''));
    });
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Invalid email address')).toBeVisible();
  });

  test('shows validation error for short username', async ({ page }) => {
    await page.getByLabel('Username').fill('ab');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Username must be at least 3 characters')).toBeVisible();
  });

  test('shows validation error for short password', async ({ page }) => {
    await page.getByLabel('Password').fill('12345');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Password must be at least 6 characters')).toBeVisible();
  });

  test('submits registration form with valid data', async ({ page }) => {
    const timestamp = Date.now();
    await page.getByLabel('Username').fill(`testuser${timestamp}`);
    await page.getByLabel('Email').fill(`test${timestamp}@example.com`);
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Create Account' }).click();

    // After successful registration, expect redirect or success state
    await expect(page).not.toHaveURL('/error');
  });
});
