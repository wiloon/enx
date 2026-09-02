import { test, expect } from '@playwright/test';

test.describe('Cognito sign in', () => {
  test('shows Cognito sign in entry point', async ({ page }) => {
    await page.goto('/');
    // "Sign in to ENX" is a shadcn <CardTitle> (a <div>), not a heading element.
    await expect(page.getByText('Sign in to ENX')).toBeVisible();
    await expect(
      page.getByText('Use your email or Google account via AWS Cognito.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('redirects to Cognito Hosted UI when Sign in is clicked', async ({ page }) => {
    await page.goto('/');
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
