import { Buffer } from "buffer";
import type { BreakCode, AttestationRole } from "@stellarclear/schemas";
import type {
  BreakCode as ContractBreakCode,
  AttestationRole as ContractAttestationRole,
  CaseStatus as ContractCaseStatus,
  SettlementCase as ContractSettlementCase,
  Attestation as ContractAttestation,
} from "settlement-registry";
import type { CaseRecord, AttestationRecord } from "./types.js";

/**
 * Converts domain BreakCode enum string to Soroban contract union tag.
 */
export function breakCodeToContract(code: BreakCode): ContractBreakCode {
  switch (code) {
    case "AMOUNT_MISMATCH":
      return { tag: "AmountMismatch", values: undefined };
    case "ASSET_MISMATCH":
      return { tag: "AssetMismatch", values: undefined };
    case "DESTINATION_MISMATCH":
      return { tag: "DestinationMismatch", values: undefined };
    case "REFERENCE_MISMATCH":
      return { tag: "ReferenceMismatch", values: undefined };
    case "MISSING_SETTLEMENT":
      return { tag: "MissingSettlement", values: undefined };
    case "DUPLICATE_SETTLEMENT":
      return { tag: "DuplicateSettlement", values: undefined };
    case "LATE_SETTLEMENT":
      return { tag: "LateSettlement", values: undefined };
    case "FAILED_TRANSACTION":
      return { tag: "FailedTransaction", values: undefined };
    case "UNEXPECTED_TRANSACTION":
      return { tag: "UnexpectedTransaction", values: undefined };
    default:
      throw new Error(`Unknown break code: ${code}`);
  }
}

/**
 * Converts Soroban contract break code tag to domain BreakCode string.
 */
export function contractToBreakCode(contractCode: ContractBreakCode): BreakCode {
  switch (contractCode.tag) {
    case "AmountMismatch":
      return "AMOUNT_MISMATCH";
    case "AssetMismatch":
      return "ASSET_MISMATCH";
    case "DestinationMismatch":
      return "DESTINATION_MISMATCH";
    case "ReferenceMismatch":
      return "REFERENCE_MISMATCH";
    case "MissingSettlement":
      return "MISSING_SETTLEMENT";
    case "DuplicateSettlement":
      return "DUPLICATE_SETTLEMENT";
    case "LateSettlement":
      return "LATE_SETTLEMENT";
    case "FailedTransaction":
      return "FAILED_TRANSACTION";
    case "UnexpectedTransaction":
      return "UNEXPECTED_TRANSACTION";
    default:
      throw new Error(`Unknown contract break code tag: ${(contractCode as { tag: string }).tag}`);
  }
}

/**
 * Converts domain AttestationRole enum to Soroban contract union tag.
 */
export function attestationRoleToContract(role: AttestationRole): ContractAttestationRole {
  switch (role) {
    case "OWNER":
      return { tag: "Owner", values: undefined };
    case "COUNTERPARTY":
      return { tag: "Counterparty", values: undefined };
    case "OBSERVER":
      return { tag: "Observer", values: undefined };
    default:
      throw new Error(`Unknown attestation role: ${role}`);
  }
}

/**
 * Converts Soroban contract attestation role tag to domain string.
 */
export function contractToAttestationRole(role: ContractAttestationRole): AttestationRole {
  switch (role.tag) {
    case "Owner":
      return "OWNER";
    case "Counterparty":
      return "COUNTERPARTY";
    case "Observer":
      return "OBSERVER";
    default:
      throw new Error(`Unknown contract role tag: ${(role as { tag: string }).tag}`);
  }
}

/**
 * Decodes raw Soroban SettlementCase contract record into domain CaseRecord.
 */
export function decodeCaseRecord(caseId: string, raw: ContractSettlementCase): CaseRecord {
  let observation: CaseRecord["observation"] = undefined;
  if (raw.observation.tag === "Observed") {
    const obs = raw.observation.values[0];
    observation = {
      txHash: Buffer.from(obs.tx_hash).toString("hex").toLowerCase(),
      observationCommitment: Buffer.from(obs.observation_commitment).toString("hex").toLowerCase(),
      observedLedger: obs.observed_ledger,
    };
  }

  let decision: CaseRecord["decision"] = { type: "NONE" };
  if (raw.decision.tag === "Matched") {
    decision = { type: "MATCHED" };
  } else if (raw.decision.tag === "Break") {
    const rawBreakCode = raw.decision.values[0];
    decision = {
      type: "BREAK",
      breakCode: contractToBreakCode(rawBreakCode),
    };
  }

  return {
    caseId: caseId.toLowerCase(),
    owner: raw.owner,
    counterparty: raw.counterparty ?? undefined,
    termsCommitment: Buffer.from(raw.terms_commitment).toString("hex").toLowerCase(),
    expiresAtLedger: raw.expires_at_ledger,
    status: raw.status.tag.toUpperCase(),
    observation,
    decision,
    createdAtLedger: raw.created_at_ledger,
    finalizedAtLedger: raw.finalized_at_ledger ?? undefined,
    observerQuorum: raw.observer_quorum ?? 1,
    disputeExpiresAtLedger: raw.dispute_expires_at_ledger ?? undefined,
  };
}

/**
 * Decodes raw Soroban Attestation record into domain AttestationRecord.
 */
export function decodeAttestationRecord(
  caseId: string,
  attestor: string,
  raw: ContractAttestation
): AttestationRecord {
  return {
    caseId: caseId.toLowerCase(),
    attestor,
    role: contractToAttestationRole(raw.role),
    commitment: Buffer.from(raw.commitment).toString("hex").toLowerCase(),
    attestedAtLedger: raw.attested_at_ledger,
  };
}
