import { assertAllowedTransition, type TransitionMap } from './transition-guard.js';

/** Agent result claim state machine (architecture handoff §9.2). */
export const AGENT_CLAIM_STATES = [
  'PENDING',
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'REJECTED',
  'UNRESOLVED',
  'REVERSED',
] as const;
export type AgentClaimState = (typeof AGENT_CLAIM_STATES)[number];

export const AGENT_CLAIM_TRANSITIONS: TransitionMap<AgentClaimState> = {
  PENDING: ['VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED', 'UNRESOLVED'],
  VERIFIED: ['REVERSED'],
  PARTIALLY_VERIFIED: ['REVERSED'],
  REJECTED: [],
  UNRESOLVED: ['VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED'],
  REVERSED: [],
};

export function assertAgentClaimTransition(from: AgentClaimState, to: AgentClaimState): void {
  assertAllowedTransition('agent_claim', AGENT_CLAIM_TRANSITIONS, from, to);
}
