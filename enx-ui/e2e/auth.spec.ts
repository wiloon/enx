import { test, expect } from '@playwright/test';

test.describe('marketing landing', () => {
  test('/ is the public landing page, not the login form', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /learn english while you read the web/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /add to chrome/i }).first()
    ).toBeVisible();
    await expect(page.getByText('Sign in to Catseye')).toHaveCount(0);
  });

  test('the comparison table names Catseye and a competitor', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('columnheader', { name: 'Catseye' })).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Immersive Translate' })
    ).toBeVisible();
  });
});

test.describe('Cognito sign in', () => {
  test('shows Cognito sign in entry point at /app', async ({ page }) => {
    await page.goto('/app');
    // "Sign in to Catseye" is a shadcn <CardTitle> (a <div>), not a heading.
    await expect(page.getByText('Sign in to Catseye')).toBeVisible();
    await expect(
      page.getByText('Use your email or Google account via AWS Cognito.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('redirects to Cognito Hosted UI when Sign in is clicked', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/auth\.(example\.com|us-east-1\.amazoncognito\.com)\/oauth2\/authorize/, {
      timeout: 15000,
    });

    const url = new URL(page.url());
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('client_id')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toContain('/auth/callback');
  });
});
