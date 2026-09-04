import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useState, type ReactElement } from 'react';
import { IdentityProvider } from './identity.js';
import { withRouteBoundary } from './RouteErrorBoundary.js';
import { AppShell } from '../components/shell/AppShell.js';
import { ApprovalReviewPage } from '../features/approvals/ApprovalReviewPage.js';
import { AuditReplayPage } from '../features/audit/AuditReplayPage.js';
import { CaseQueuePage } from '../features/cases/CaseQueuePage.js';
import {
  CaseWorkspacePage,
  VerificationTimelinePage,
} from '../features/cases/CaseWorkspacePage.js';
import { DataHealthPage } from '../features/data-health/DataHealthPage.js';
import { OverviewPage } from '../features/overview/OverviewPage.js';
import { NotFoundState } from '../features/shell/states/StatePanels.js';

export function App(): ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <IdentityProvider>
        <BrowserRouter>
          <Routes>
            <Route element={withRouteBoundary('application-shell', <AppShell />)}>
              <Route index element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={withRouteBoundary('/overview', <OverviewPage />)} />
              <Route path="/cases" element={withRouteBoundary('/cases', <CaseQueuePage />)} />
              <Route
                path="/cases/:caseId"
                element={withRouteBoundary('/cases/:caseId', <CaseWorkspacePage />)}
              />
              <Route
                path="/cases/:caseId/verification"
                element={withRouteBoundary(
                  '/cases/:caseId/verification',
                  <VerificationTimelinePage />,
                )}
              />
              <Route
                path="/approvals"
                element={withRouteBoundary('/approvals', <ApprovalReviewPage />)}
              />
              <Route path="/audit" element={withRouteBoundary('/audit', <AuditReplayPage />)} />
              <Route
                path="/data-health"
                element={withRouteBoundary('/data-health', <DataHealthPage />)}
              />
              <Route
                path="*"
                element={withRouteBoundary(
                  'not-found',
                  <NotFoundState
                    title="Page not found"
                    body="The requested synthetic-demo page does not exist."
                    backTo="/overview"
                    backLabel="Return to Overview"
                  />,
                )}
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </IdentityProvider>
    </QueryClientProvider>
  );
}
