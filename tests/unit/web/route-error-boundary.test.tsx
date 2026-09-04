// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from '../../../src/web/app/RouteErrorBoundary.js';

function BrokenScreen(): never {
  throw new Error('sensitive implementation detail');
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe('route render boundary', () => {
  it('contains a screen crash and exposes only a safe retry state', () => {
    render(
      <RouteErrorBoundary resetKey="broken-screen">
        <BrokenScreen />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This screen could not be rendered');
    expect(screen.getByRole('button', { name: 'Try rendering again' })).toBeVisible();
    expect(screen.queryByText('sensitive implementation detail')).not.toBeInTheDocument();
  });
});
