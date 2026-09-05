// Captures a numbered sequence of 1920x1080 PNG screenshots walking through
// the entire MoneyTrace operator console — every page, every demo role, every
// scenario outcome — for use as source images in a video/notebook tool
// (e.g. NotebookLM) alongside demo-assets/DEMO_SCRIPT.md.
//
// Usage:
//   npm run dev:web            (in one terminal — the app must already be running)
//   node scripts/demo/capture-screenshots.mjs   (in another terminal)
//
// Runs entirely against the frontend fixture layer — no backend, database, or
// worker is required. Uses its own isolated browser profile, so it never
// touches your own browser's localStorage or session.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../');
const OUT_DIR = path.join(REPO_ROOT, 'demo-assets', 'screenshots');
const BASE_URL = process.env.DEMO_BASE_URL || 'http://127.0.0.1:5173';
const VIEWPORT = { width: 1920, height: 1080 };

let shotIndex = 0;

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  -> ${path.basename(file)}`);
  shotIndex += 1;
}

// A tight, element-scoped shot (close-up) rather than the full 1920x1080 frame
// — used where the interesting content is a specific card/section, so
// consecutive "before/after" scenes render as genuinely distinct frames
// instead of two identical full-page screenshots.
async function shotElement(page, locator, name) {
  const file = path.join(OUT_DIR, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await locator.screenshot({ path: file });
  console.log(`  -> ${path.basename(file)} (close-up)`);
  shotIndex += 1;
}

async function openApp(page, routePath, { demoState, approvalState } = {}) {
  await page.goto(BASE_URL + routePath, { waitUntil: 'domcontentloaded' });
  if (demoState || approvalState) {
    await page.evaluate(
      ({ demoState, approvalState }) => {
        if (demoState) window.localStorage.setItem('moneytrace:demo-state', JSON.stringify(demoState));
        if (approvalState)
          window.localStorage.setItem('moneytrace:approval-state', JSON.stringify(approvalState));
      },
      { demoState, approvalState },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);
}

function roleTrigger(page) {
  // The desktop header renders the role switcher without an aria-label (that
  // only exists on the compact/mobile variant) — target it by its stable class.
  return page.locator('button.role-trigger').first();
}

async function switchRole(page, roleRegex) {
  await roleTrigger(page).click();
  await page.getByRole('menuitemradio', { name: roleRegex }).click();
  await page.waitForTimeout(500);
}

async function openScenarioDrawer(page) {
  await page.getByRole('button', { name: 'Demo scenarios' }).first().click();
  await page.waitForTimeout(300);
}

async function advanceScenario(page, scenarioLabel) {
  const card = page.locator('.scenario-card').filter({ hasText: scenarioLabel });
  await card.locator('button.scenario-advance-button').click();
  await page.waitForTimeout(1000);
}

async function closeDrawer(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();

  console.log(`Capturing MoneyTrace demo screenshots from ${BASE_URL}\n`);

  // ---- 00-03 — Overview: cold open, roles, scenario controller ----
  await openApp(page, '/overview', { demoState: { steps: {}, last: null } });
  await shot(page, 'cold-open-overview-baseline-empty');

  await roleTrigger(page).click();
  await page.waitForTimeout(250);
  await shot(page, 'role-switcher-open-four-roles');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await switchRole(page, /Demo Operator/);
  await shot(page, 'operator-role-demo-scenarios-button-appears');

  await openScenarioDrawer(page);
  await shot(page, 'demo-scenario-controller-drawer');

  // ---- 04-06 — claim-reversal: PENDING -> VERIFIED -> REVERSED ----
  await advanceScenario(page, 'claim reversal');
  await closeDrawer(page);
  await shot(page, 'claim-reversal-step1-pending-120000');

  await openScenarioDrawer(page);
  await advanceScenario(page, 'claim reversal');
  await closeDrawer(page);
  await shot(page, 'claim-reversal-step2-verified-120000');

  await openScenarioDrawer(page);
  await advanceScenario(page, 'claim reversal');
  await closeDrawer(page);
  await shot(page, 'claim-reversal-step3-reversed-to-zero');

  // ---- 07 — full KPI + charts context ----
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);
  await shot(page, 'overview-kpi-cards-and-charts');
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(200);

  // ---- 08 — missing-transfer-remediation: VERIFIED 455000, full chain ----
  await openApp(page, '/overview', {
    demoState: { steps: { 'missing-transfer-remediation': 4 }, last: 'missing-transfer-remediation' },
  });
  await switchRole(page, /Demo Operator/);
  await shot(page, 'missing-transfer-step4-verified-455000-full-chain');

  // ---- 09 — conflicting-bank-evidence: UNRESOLVED ----
  await openApp(page, '/overview', {
    demoState: { steps: { 'conflicting-bank-evidence': 3 }, last: 'conflicting-bank-evidence' },
  });
  await switchRole(page, /Demo Operator/);
  await shot(page, 'conflicting-bank-evidence-unresolved');

  // ---- 10 — duplicate-replay: REJECTED ----
  await openApp(page, '/overview', {
    demoState: { steps: { 'duplicate-replay': 4 }, last: 'duplicate-replay' },
  });
  await switchRole(page, /Demo Operator/);
  await shot(page, 'duplicate-replay-rejected-prevented');

  // ---- 11 — Highest material unresolved cases table ----
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  await shot(page, 'overview-highest-unresolved-cases-table');
  await page.mouse.wheel(0, -1200);

  // ---- 12 — Cases queue ----
  await openApp(page, '/cases');
  await shot(page, 'cases-queue-full-table');

  // ---- 13-15 — Case workspace CASE-2077 (flagship) ----
  await openApp(page, '/cases/CASE-2077');
  await shot(page, 'case-workspace-header-case2077');

  await shotElement(
    page,
    page.locator('section[aria-label="Expected versus observed money path"]'),
    'case-workspace-money-path-connector-edges',
  );

  await shotElement(
    page,
    page.locator('section[aria-label="Verification timeline"]'),
    'case-workspace-verification-timeline-acknowledged',
  );

  // ---- 16-17 — contextual commands: Viewer (locked) vs Investigator (enabled) ----
  const controlRail = page.locator('aside[aria-label="Control loop"]');
  await shotElement(page, controlRail, 'case-commands-viewer-disabled');

  await switchRole(page, /Investigator/);
  await shotElement(page, controlRail, 'case-commands-investigator-enabled');

  // ---- 18-21 — Approvals: locked -> role switch -> approve -> success ----
  await openApp(page, '/approvals');
  await shot(page, 'approvals-queue-tabs-and-counts');

  await page.getByText('Review approval', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await shot(page, 'approvals-drawer-viewer-locked');
  await closeDrawer(page);

  await switchRole(page, /Finance Approver/);
  await page.getByText('Review approval', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await shot(page, 'approvals-drawer-finance-approver-enabled');

  await page
    .locator('.apr-drawer-foot')
    .getByRole('button', { name: /Approve simulated remediation/ })
    .click();
  await page.waitForTimeout(300);
  await page.locator('.apr-dialog-scrim').getByRole('button', { name: /Approve/ }).click();
  await page.waitForTimeout(1400);
  await shot(page, 'approvals-success-human-approval-recorded');

  // ---- 22-23 — Audit replay ----
  await openApp(page, '/audit?case=CASE-2077');
  await shot(page, 'audit-replay-full-trail');

  await page.getByRole('button', { name: /Export redacted audit/ }).click();
  await page.waitForTimeout(400);
  await shot(page, 'audit-export-redacted-dialog');

  // ---- 24 — Data Health ----
  await openApp(page, '/data-health');
  await shot(page, 'data-health-overview');

  // ---- 25 — Closing shot: back to the flagship verified frame ----
  await openApp(page, '/overview', {
    demoState: { steps: { 'missing-transfer-remediation': 4 }, last: 'missing-transfer-remediation' },
  });
  await switchRole(page, /Demo Operator/);
  await shot(page, 'closing-shot-overview-verified-455000');

  await browser.close();
  console.log(`\nDone. ${shotIndex} screenshots saved to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exitCode = 1;
});
