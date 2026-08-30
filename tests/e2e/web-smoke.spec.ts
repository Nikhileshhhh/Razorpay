import { expect, test } from './fixtures';

/**
 * Browser smoke test for the React/Vite web scaffold. The Vite dev server runs
 * in-process via the worker-scoped fixture in ./fixtures (no external process to
 * leak). Checks the placeholder shell renders. No fabricated data or fake
 * success state is asserted.
 */
test('web scaffold renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MoneyTrace' })).toBeVisible();
  await expect(page.getByTestId('scaffold-status')).toContainText('Scaffold ready');
});
