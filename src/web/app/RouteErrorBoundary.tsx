import { Component, type ReactElement, type ReactNode } from 'react';

interface RouteErrorBoundaryProps {
  readonly children: ReactNode;
  readonly resetKey: string;
}

interface RouteErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Keeps a render failure local to one screen and never exposes exception text,
 * response bodies, or financial data in the fallback.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  override state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
  }

  override componentDidUpdate(previous: RouteErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="route-error" role="alert" aria-labelledby="route-error-title">
        <p className="page-eyebrow">Safe render boundary</p>
        <h1 id="route-error-title">This screen could not be rendered</h1>
        <p>No financial command was submitted. Retry this local render when you are ready.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => this.setState({ failed: false })}
        >
          Try rendering again
        </button>
      </section>
    );
  }
}

export function withRouteBoundary(
  resetKey: string,
  element: ReactElement,
): ReactElement<RouteErrorBoundaryProps> {
  return <RouteErrorBoundary resetKey={resetKey}>{element}</RouteErrorBoundary>;
}
