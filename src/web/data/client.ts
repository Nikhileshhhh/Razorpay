import type { ZodType } from 'zod';
import { ErrorEnvelope, type ErrorCode } from '../../contracts/index.js';

export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNSUPPORTED_RESPONSE';
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(input: {
    message: string;
    code: ErrorCode | 'NETWORK_ERROR' | 'UNSUPPORTED_RESPONSE';
    requestId?: string | null;
    retryable?: boolean;
    status?: number | null;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.retryable = input.retryable ?? false;
    this.status = input.status ?? null;
  }
}

interface ApiRequestOptions {
  readonly userId: string;
  readonly signal?: AbortSignal;
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  options: ApiRequestOptions,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      signal: options.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-demo-user-id': options.userId,
        'x-request-id': crypto.randomUUID(),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'MoneyTrace could not reach the synthetic demo service.',
      retryable: true,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError({
      code: 'UNSUPPORTED_RESPONSE',
      message: 'The service returned an unreadable response.',
      status: response.status,
    });
  }

  if (!response.ok) {
    const parsedError = ErrorEnvelope.safeParse(payload);
    if (parsedError.success) {
      throw new ApiError({
        code: parsedError.data.error.code,
        message: parsedError.data.error.message,
        requestId: parsedError.data.error.request_id,
        retryable: parsedError.data.error.retryable,
        status: response.status,
      });
    }
    throw new ApiError({
      code: 'UNSUPPORTED_RESPONSE',
      message: 'The service returned an unsupported error response.',
      status: response.status,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      code: 'UNSUPPORTED_RESPONSE',
      message: 'The service response does not match the MoneyTrace contract.',
      status: response.status,
    });
  }
  return parsed.data;
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError({
        code: 'UNSUPPORTED_RESPONSE',
        message: 'MoneyTrace encountered an unexpected response.',
      });
}
