import type { ReactElement } from 'react';

/**
 * MoneyTrace web application shell (placeholder).
 *
 * MT-001 renders a minimal, honest placeholder — no fabricated metrics, no fake
 * AI "thinking", no mocked success state (CODEX_REVIEW_CHECKLIST §11). The real
 * operational shell, overview, and case queue are built in MT-019 using the
 * public Blade design system and real backend projections.
 */
export function App(): ReactElement {
  return (
    <main>
      <h1>MoneyTrace</h1>
      <p data-testid="scaffold-status">Scaffold ready. Feature screens are not implemented yet.</p>
    </main>
  );
}
