// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/web/app/App.js';

const manifestHash = `sha256:${'7b42'.padEnd(60, '0')}91ef`;

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const demoStatus = {
  schema_version: '1.0',
  request_id: 'req_demo_status',
  data: {
    schema_version: '1.0',
    seed_id: 'moneytrace_demo_v1',
    ready: true,
    fixed_clock: '2026-08-25T05:20:00.000Z',
    manifest_hash: manifestHash,
    manifest: {
      records_total: 500,
      records_matched: 468,
      unresolved_cases: 16,
      unsafe_candidate_matches_blocked: 4,
      unresolved_exposure: '128000000',
      verified_restored: '0',
      duplicate_collection_prevented: '50000000',
      reversed_recovery: '0',
    },
    scenarios: [
      {
        scenario_id: 'missing-transfer-remediation',
        current_step: 0,
        completed_step: 0,
        total_steps: 6,
        state_version: 0,
        status: 'completed',
        last_error: null,
      },
      {
        scenario_id: 'claim-reversal',
        current_step: 0,
        completed_step: 0,
        total_steps: 3,
        state_version: 0,
        status: 'completed',
        last_error: null,
      },
    ],
  },
};

const dataHealth = {
  schema_version: '1.0',
  request_id: 'req_data_health',
  data: {
    schema_version: '1.0',
    generated_at: '2026-08-25T05:20:00.000Z',
    model_mode: 'stub',
    database: 'up',
    worker: 'up',
    sources: [
      {
        source_system: 'SYNTHETIC_BANK',
        capability: 'synthetic',
        received: 20,
        signed: 20,
        unsigned: 0,
        duplicate: 0,
        conflict: 0,
        schema_failure: 0,
      },
    ],
    received_total: 500,
    duplicate_total: 0,
    conflict_total: 0,
    schema_failure_total: 0,
    projector_lag_seconds: 0,
    job_lag_seconds: 0,
    pending_verification: 0,
    unlinked: 0,
    candidate_links: 4,
    stale_projections: 0,
  },
};

// The shell tests park on `/cases` as a neutral route to exercise shell chrome
// (banners, role switching, dialogs) without depending on page content; the
// Case Queue page itself now issues a real `/v1/cases` read, so every fetch
// mock below must answer it with a well-formed (if empty) case list.
const emptyCaseList = {
  schema_version: '1.0',
  request_id: 'req_cases',
  data: { items: [], page_info: { next_cursor: null, has_more: false } },
};

function bodyFor(path: string, health: typeof dataHealth, status: typeof demoStatus): unknown {
  if (path.includes('/cases')) return emptyCaseList;
  if (path.includes('/data-health')) return health;
  return status;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/cases');
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('crypto', { randomUUID: () => 'client-request-id' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      return new Response(JSON.stringify(bodyFor(path, dataHealth, demoStatus)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MoneyTrace application shell', () => {
  it('exposes and can enter each of the four fixed demo identities', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Optional Razorpay Test source unavailable');

    for (const label of [
      'Investigator / Case Manager',
      'Finance Approver',
      'Demo Operator / Auditor',
      'Viewer',
    ]) {
      await user.click(screen.getAllByRole('button', { name: /Demo role/i })[0]!);
      await user.click(await screen.findByRole('menuitemradio', { name: new RegExp(label) }));
      await waitFor(() =>
        expect(screen.getByText(`Demo role changed to ${label}`)).toBeInTheDocument(),
      );
    }
  });

  it('renders the required landmarks, navigation order, environment, and API status', async () => {
    render(<App />);

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('heading', { level: 1, name: 'Cases' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(nav).toHaveTextContent('OverviewCasesApprovalsAuditData Health');
    expect(screen.getAllByText('Synthetic Demo').length).toBeGreaterThan(0);
    expect(await screen.findByText('Optional Razorpay Test source unavailable')).toBeVisible();
    expect(screen.getAllByText('7b42…91ef').length).toBeGreaterThan(0);
    expect(screen.queryByText(/sha2…/)).not.toBeInTheDocument();
  });

  it('shows an assertive reset banner only from the API ready state', async () => {
    const resetStatus = {
      ...demoStatus,
      data: { ...demoStatus.data, ready: false },
    };
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const path = String(input);
      return new Response(JSON.stringify(bodyFor(path, dataHealth, resetStatus)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    render(<App />);
    expect(
      await screen.findByRole('alert', {
        name: 'Demo reset in progress. Financial mutations are temporarily unavailable.',
      }),
    ).toHaveTextContent(
      'Approve, simulate and reconcile are disabled. Read, audit and export continue.',
    );
  });

  it('renders no status banner when infrastructure and the optional source are available', async () => {
    const nominalHealth = {
      ...dataHealth,
      data: {
        ...dataHealth.data,
        sources: [
          ...dataHealth.data.sources,
          {
            source_system: 'RAZORPAY_TEST',
            capability: 'available',
            received: 1,
            signed: 1,
            unsigned: 0,
            duplicate: 0,
            conflict: 0,
            schema_failure: 0,
          },
        ],
      },
    };
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const path = String(input);
      return new Response(JSON.stringify(bodyFor(path, nominalHealth, demoStatus)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    render(<App />);
    expect((await screen.findAllByText('Razorpay Test connected')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('status', { name: /source unavailable/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows only the safe server-denied envelope and request id', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schema_version: '1.0',
          error: {
            code: 'POLICY_DENIED',
            message: 'demo role is not permitted',
            request_id: 'req_shell_denied',
            retryable: false,
            details: { kind: 'none' },
          },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<App />);
    const alert = await screen.findByRole('alert', { name: 'Action refused by server' });
    expect(alert).toHaveTextContent('This demo role is not permitted');
    expect(alert).toHaveTextContent('Request ID req_shell_denied');
  });

  it('opens the structured mobile dataset sheet and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Optional Razorpay Test source unavailable');
    const trigger = screen.getByRole('button', {
      name: /Open dataset and demo controls/,
    });
    await user.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: 'Dataset & demo controls' });
    expect(sheet).toBeVisible();
    expect(sheet).toHaveTextContent('Razorpay Test — source unavailable');
    expect(sheet).toHaveTextContent('Synthetic bank & Route evidence available');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Dataset & demo controls' }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it('switches to the operator using a real refetch state and exposes scenario status', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Optional Razorpay Test source unavailable');

    const roleTriggers = screen.getAllByRole('button', { name: /Demo role/i });
    await user.click(roleTriggers[0]!);
    await user.click(
      await screen.findByRole('menuitemradio', { name: /Demo Operator \/ Auditor/i }),
    );

    await waitFor(() =>
      expect(screen.getByText('Demo role changed to Demo Operator / Auditor')).toBeInTheDocument(),
    );
    const scenarioButtons = screen.getAllByRole('button', { name: 'Demo scenarios' });
    await user.click(scenarioButtons[0]!);
    expect(
      await screen.findByRole('dialog', { name: 'Demo scenario controller' }),
    ).toBeInTheDocument();
    expect(screen.getByText('missing transfer remediation')).toBeVisible();
  });

  it('closes the mobile navigation with Escape and restores focus to its trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus(),
    );
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it('keeps keyboard focus inside the mobile navigation drawer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    const close = screen.getByRole('button', { name: 'Close navigation' });
    await waitFor(() => expect(close).toHaveFocus());

    await user.tab({ shift: true });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(close).toHaveFocus();
  });

  it('marks nested case routes as part of the Cases navigation destination', async () => {
    window.history.replaceState({}, '', '/cases/case_demo');
    render(<App />);

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(nav.getElementsByClassName('nav-link--active')).toHaveLength(2);
    for (const activeLink of Array.from(nav.getElementsByClassName('nav-link--active'))) {
      expect(activeLink).toHaveAccessibleName('Cases');
    }
  });

  it('shows the target identity while role-sensitive data is refetching', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Optional Razorpay Test source unavailable');

    let releaseReads: (() => void) | undefined;
    const readsReleased = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      await readsReleased;
      const path = String(input);
      return new Response(JSON.stringify(bodyFor(path, dataHealth, demoStatus)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await user.click(screen.getAllByRole('button', { name: /Demo role/i })[0]!);
    await user.click(await screen.findByRole('menuitemradio', { name: /Finance Approver/i }));

    expect(await screen.findByText('Switching to Finance Approver…')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Demo role/i })[0]).toHaveAttribute(
      'aria-busy',
      'true',
    );
    releaseReads?.();
    await waitFor(() =>
      expect(screen.getByText('Demo role changed to Finance Approver')).toBeInTheDocument(),
    );
  });

  it('has no automated accessibility violations in the stable shell state', async () => {
    const { container } = render(<App />);
    await screen.findByText('Optional Razorpay Test source unavailable');
    const result = await axe(container);
    expect(result.violations).toHaveLength(0);
  });
});
