import { expect, test } from './fixtures';

/**
 * Browser checks for the checkpoint-1 shell. The fixture owns only Vite: when a
 * local API is already running the shell must show its connected source fact;
 * otherwise it must render an honest, retryable source-unavailable state.
 */
test('desktop shell renders exact navigation and authoritative service status', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/cases');

  await expect(page.getByRole('heading', { level: 1, name: 'Cases' })).toBeVisible();
  await expect(page.locator('.sidebar-footnote')).toContainText('moneytrace_demo_v1', {
    timeout: 15_000,
  });
  await expect(page.locator('.sidebar .nav-full .nav-link')).toHaveText([
    'Overview',
    'Cases',
    'Approvals',
    'Audit',
    'Data Health',
  ]);
  await expect(page.locator('.desktop-header .environment-badge')).toContainText('Synthetic Demo');
  await expect(page.locator('.desktop-header .source-status')).toBeVisible();
  await expect(page.locator('.desktop-header .source-status')).toContainText(
    /Source unavailable|Razorpay Test connected/,
  );
  await expect(page.getByRole('main')).toContainText('page content region');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '248px');
  await expect(page.locator('.desktop-header-primary')).toHaveCSS('height', '64px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: testInfo.outputPath('application-shell-desktop.png') });
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveCSS('outline-width', '2px');
  await page.screenshot({ path: testInfo.outputPath('application-shell-desktop-skip-focus.png') });
});

test('tablet shell retains environment and accessible compact navigation', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto('/cases');

  await expect(page.getByRole('heading', { level: 1, name: 'Cases' })).toBeVisible();
  await expect(page.locator('.manifest-chip strong').first()).not.toHaveText('unavailable', {
    timeout: 15_000,
  });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .nav-compact')).toBeVisible();
  await expect(page.locator('.desktop-header .environment-badge')).toContainText('Synthetic Demo');
  const compactLinks = page.locator('.sidebar .nav-compact .nav-link');
  await expect(compactLinks).toHaveCount(5);
  for (const [index, label] of [
    'Overview',
    'Cases',
    'Approvals',
    'Audit',
    'Data Health',
  ].entries()) {
    await expect(compactLinks.nth(index)).toHaveAccessibleName(
      label === 'Data Health' ? /^Data Health(?:, degraded)?$/ : label,
    );
  }
  await expect(page.locator('.sidebar')).toHaveCSS('width', '72px');
  await expect(page.locator('.desktop-header-primary')).toHaveCSS('height', '56px');
  await expect(page.locator('.tablet-metadata-row')).toHaveCSS('height', '38px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  await page.screenshot({ path: testInfo.outputPath('application-shell-tablet.png') });

  const expand = page.getByRole('button', { name: 'Expand navigation' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  const railDrawer = page.getByRole('dialog', { name: 'MoneyTrace' });
  await expect(railDrawer).toBeVisible();
  await expect(railDrawer).toHaveCSS('width', '264px');
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeFocused();
  await expect(railDrawer).not.toContainText('Synthetic Demo');
  await expect(railDrawer).not.toContainText('DEMO ROLE');
  await page.screenshot({ path: testInfo.outputPath('application-shell-tablet-drawer.png') });
  await page.keyboard.press('Escape');
  await expect(railDrawer).toBeHidden();
  await expect(expand).toBeFocused();
});

test('compact desktop folds metadata without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cases');

  await expect(page.locator('.sidebar')).toHaveCSS('width', '248px');
  await expect(page.locator('.tablet-metadata-row')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test('mobile drawer traps focus, closes on Escape, and restores its trigger', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cases');

  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await expect(page.locator('.mobile-dataset-trigger')).toContainText('25 Aug', {
    timeout: 15_000,
  });
  const environment = page.locator('.mobile-topbar .environment-badge');
  await expect(environment).toContainText('Synthetic');
  await expect(environment).toHaveAccessibleName('Synthetic Demo environment');
  await page.screenshot({ path: testInfo.outputPath('application-shell-mobile-default.png') });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  const closeNavigation = page.getByRole('button', { name: 'Close navigation' });
  await expect(closeNavigation).toBeFocused();
  await expect(closeNavigation).toHaveCSS('width', '44px');
  await expect(closeNavigation).toHaveCSS('height', '44px');
  await expect(closeNavigation).toHaveCSS('outline-width', '2px');
  const drawerEnvironment = drawer.locator('.environment-badge');
  expect((await drawerEnvironment.boundingBox())?.width).toBeLessThan(160);
  const mobileLinks = drawer
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link');
  await expect(mobileLinks).toHaveText(['Overview', 'Cases', 'Approvals', 'Audit', 'Data Health']);
  if (await page.locator('.status-banner--degraded').isVisible()) {
    await expect(drawer.locator('.nav-degraded-label')).toHaveText('Degraded');
  }
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.locator(':focus')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(closeNavigation).toBeFocused();
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('application-shell-mobile-drawer.png') });
  await page.locator('.drawer-overlay').click({ position: { x: 380, y: 400 } });
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();

  const datasetTrigger = page.getByRole('button', { name: /Open dataset and demo controls/ });
  await expect(datasetTrigger).toHaveAttribute('aria-expanded', 'false');
  await datasetTrigger.click();
  await expect(datasetTrigger).toHaveAttribute('aria-expanded', 'true');
  const datasetSheet = page.getByRole('dialog', { name: 'Dataset & demo controls' });
  await expect(datasetSheet).toBeVisible();
  const closeDataset = page.getByRole('button', { name: 'Close dataset and demo controls' });
  await expect(closeDataset).toBeFocused();
  await expect(closeDataset).toHaveCSS('width', '44px');
  await expect(closeDataset).toHaveCSS('height', '44px');
  await expect(datasetSheet).toContainText('Synthetic bank & Route evidence available');
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('application-shell-mobile-sheet.png') });
  await page.keyboard.press('Escape');
  await expect(datasetTrigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('role menu and reduced-motion focus treatments match the shell specification', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/cases');
  await expect(page.locator('.sidebar-footnote')).toContainText('moneytrace_demo_v1', {
    timeout: 15_000,
  });

  const roleTrigger = page.locator('.desktop-header-primary .role-trigger');
  await roleTrigger.click();
  await expect(roleTrigger).toHaveCSS('outline-width', '2px');
  const roleMenu = page.getByRole('menu');
  await expect(roleMenu).toBeVisible();
  await page.keyboard.press('End');
  const operator = page.getByRole('menuitemradio', { name: /Demo Operator \/ Auditor/i });
  await expect(operator).toBeFocused();
  await expect(operator).toHaveCSS('outline-width', '2px');
  await page.screenshot({ path: testInfo.outputPath('application-shell-role-menu.png') });
  await page.keyboard.press('Escape');
  await expect(roleTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const navigationTrigger = page.getByRole('button', { name: 'Open navigation' });
  await navigationTrigger.click();
  await expect(page.locator('.navigation-drawer')).toHaveCSS('animation-duration', '0.01ms');
});
