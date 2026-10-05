import type { BreakCode, AttestationRole } from "@stellarclear/schemas";
import type {
  BreakCode as ContractBreakCode,
  AttestationRole as ContractAttestationRole,
  CaseStatus as ContractCaseStatus,
  Decision as ContractDecision,
  Observation as ContractObservation,
  SettlementCase as ContractSettlementCase,
  Attestation as ContractAttestation,
} from "settlement-registry";

/**
 * Domain-mapped Settlement Case representation decoded from on-chain contract state.
 */
export interface CaseRecord {
  caseId: string;
  owner: string;
  counterparty?: string;
  termsCommitment: string;
  expiresAtLedger: number;
  status: string;
  observation?: {
    txHash: string;
    observationCommitment: string;
    observedLedger: number;
  };
  decision: {
    type: "NONE" | "MATCHED" | "BREAK";
    breakCode?: BreakCode;
  };
  createdAtLedger: number;
  finalizedAtLedger?: number;
  observerQuorum?: number;
  disputeExpiresAtLedger?: number;
}

/**
 * Domain-mapped Attestation record decoded from contract state.
 */
export interface AttestationRecord {
  caseId: string;
  attestor: string;
  role: AttestationRole;
  commitment: string;
  attestedAtLedger: number;
}

export interface TransactionResult<T = void> {
  txHash: string;
  ledger?: number;
  result: T;
  status: "SUCCESS" | "FAILED";
}

/**
 * Result of evaluating observer quorum satisfaction against distinct authorized observers.
 */
export interface QuorumVerificationResult {
  caseId: string;
  requiredObserverQuorum: number;
  submittedObserverCount: number;
  distinctObserverCount: number;
  quorumSatisfied: boolean;
  distinctObservers: string[];
}
