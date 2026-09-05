/**
 * Client-side approval decisions for the fixture prototype. The Approval Review
 * page records Approve / Reject / Request-more-evidence here (persisted to
 * localStorage) so a decided row visibly moves between tabs and survives
 * navigation — with no backend. Mirrors the demo-state store pattern.
 */

export type ApprovalDecision = 'approve' | 'reject' | 'request';

export interface ApprovalOverride {
  readonly decision: ApprovalDecision;
  readonly reason?: string;
  readonly decidedById: string;
  readonly decidedByName: string;
  readonly decidedAtLocal: string;
}

export type ApprovalOverrides = Readonly<Record<string, ApprovalOverride>>;

const STORAGE_KEY = 'moneytrace:approval-state';

function read(): ApprovalOverrides {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return {};
    return parsed as ApprovalOverrides;
  } catch {
    return {};
  }
}

function write(value: ApprovalOverrides): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Non-persistent demo (private mode / blocked store) — ignore.
  }
}

function nowIstLabel(): string {
  return `${new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
    .format(new Date())
    .replace(',', '')} IST`;
}

export function getApprovalOverrides(): ApprovalOverrides {
  return read();
}

export function recordDecision(
  approvalId: string,
  input: {
    readonly decision: ApprovalDecision;
    readonly reason?: string;
    readonly decidedById: string;
    readonly decidedByName: string;
  },
): void {
  const current = read();
  write({
    ...current,
    [approvalId]: {
      decision: input.decision,
      reason: input.reason,
      decidedById: input.decidedById,
      decidedByName: input.decidedByName,
      decidedAtLocal: nowIstLabel(),
    },
  });
}

export function resetApprovals(): void {
  write({});
}
