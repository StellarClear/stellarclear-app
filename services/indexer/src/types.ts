import type { BreakCode, AttestationRole } from "@stellarclear/schemas";

export type SettlementEventType =
  | "ObserverAdded"
  | "ObserverRemoved"
  | "CaseCreated"
  | "ObservationRecorded"
  | "CaseMatched"
  | "CaseBroken"
  | "AttestationSubmitted"
  | "DisputeOpened"
  | "ResolutionSubmitted"
  | "DisputeResolved"
  | "DisputeExpired"
  | "CaseQuorumSet"
  | "CaseFinalized";

export interface DecodedContractEvent {
  type: SettlementEventType;
  contractId: string;
  ledger: number;
  txHash: string;
  cursor: string;
  topicXdr: string;
  dataXdr: string;
  caseId?: string;
  payload: Record<string, unknown>;
}

export interface CaseCreatedPayload {
  caseId: string;
  owner: string;
  counterparty?: string;
  expiresAtLedger: number;
}

export interface ObservationRecordedPayload {
  caseId: string;
  observer: string;
  txHash: string;
  observedLedger: number;
}

export interface CaseMatchedPayload {
  caseId: string;
  observer: string;
}

export interface CaseBrokenPayload {
  caseId: string;
  observer: string;
  breakCode: BreakCode;
}

export interface AttestationSubmittedPayload {
  caseId: string;
  attestor: string;
  role: AttestationRole;
}

export interface DisputeOpenedPayload {
  caseId: string;
  initiator: string;
  disputeCommitment: string;
}

export interface ResolutionSubmittedPayload {
  caseId: string;
  resolver: string;
  resolutionCommitment: string;
}

export interface DisputeResolvedPayload {
  caseId: string;
  resolutionCommitment: string;
}

export interface CaseFinalizedPayload {
  caseId: string;
  finalizedAtLedger: number;
}

export interface DisputeExpiredPayload {
  caseId: string;
  expirationLedger: number;
  closedAtLedger: number;
}

export interface CaseQuorumSetPayload {
  caseId: string;
  quorum: number;
}
