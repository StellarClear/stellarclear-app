import { Buffer } from "buffer";
import type { DecodedContractEvent, SettlementEventType } from "./types.js";
import { contractToBreakCode, contractToAttestationRole } from "@stellarclear/sdk";
import type {
  BreakCode as ContractBreakCode,
  AttestationRole as ContractAttestationRole,
} from "settlement-registry";

export interface RawStellarEvent {
  type: string;
  ledger: number;
  ledgerClosedAt?: string;
  contractId: string;
  id: string;
  pagingToken?: string;
  inSuccessfulContractCall?: boolean;
  txHash?: string;
  topic?: unknown[];
  value?: unknown;
}

/**
 * Decodes a raw Stellar/Soroban contract event into a strongly-typed DecodedContractEvent.
 */
export function decodeContractEvent(raw: RawStellarEvent): DecodedContractEvent | null {
  const cursor = raw.pagingToken || raw.id;
  const txHash = raw.txHash || "0".repeat(64);
  const ledger = raw.ledger;
  const contractId = raw.contractId;

  // Expected format: topic[0] is symbol / event name
  if (!raw.topic || !Array.isArray(raw.topic) || raw.topic.length === 0) {
    return null;
  }

  const eventName = String(raw.topic[0]);
  const topicXdr = JSON.stringify(raw.topic);
  const dataXdr = JSON.stringify(raw.value);

  let eventType: SettlementEventType;
  let caseId: string | undefined = undefined;
  const payload: Record<string, unknown> = {};

  switch (eventName) {
    case "ObserverAdded": {
      eventType = "ObserverAdded";
      payload["observer"] = String(raw.topic[1] ?? (raw.value as Record<string, unknown>)?.["observer"] ?? "");
      break;
    }

    case "ObserverRemoved": {
      eventType = "ObserverRemoved";
      payload["observer"] = String(raw.topic[1] ?? (raw.value as Record<string, unknown>)?.["observer"] ?? "");
      break;
    }

    case "CaseCreated": {
      eventType = "CaseCreated";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["owner"] = String(data["owner"] ?? "");
      payload["counterparty"] = data["counterparty"] ? String(data["counterparty"]) : undefined;
      payload["expiresAtLedger"] = Number(data["expires_at_ledger"] ?? data["expiresAtLedger"] ?? 0);
      break;
    }

    case "ObservationRecorded": {
      eventType = "ObservationRecorded";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["observer"] = String(data["observer"] ?? "");
      payload["txHash"] = extractHex(data["tx_hash"] ?? data["txHash"]);
      payload["observedLedger"] = Number(data["observed_ledger"] ?? data["observedLedger"] ?? 0);
      break;
    }

    case "CaseMatched": {
      eventType = "CaseMatched";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["observer"] = String(data["observer"] ?? "");
      break;
    }

    case "CaseBroken": {
      eventType = "CaseBroken";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["observer"] = String(data["observer"] ?? "");
      const rawBreak = data["break_code"] ?? data["breakCode"];
      payload["breakCode"] = typeof rawBreak === "object" && rawBreak !== null && "tag" in rawBreak
        ? contractToBreakCode(rawBreak as ContractBreakCode)
        : String(rawBreak ?? "AMOUNT_MISMATCH");
      break;
    }

    case "AttestationSubmitted": {
      eventType = "AttestationSubmitted";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["attestor"] = String(data["attestor"] ?? "");
      const rawRole = data["role"];
      payload["role"] = typeof rawRole === "object" && rawRole !== null && "tag" in rawRole
        ? contractToAttestationRole(rawRole as ContractAttestationRole)
        : String(rawRole ?? "OWNER");
      break;
    }

    case "DisputeOpened": {
      eventType = "DisputeOpened";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["initiator"] = String(data["initiator"] ?? "");
      payload["disputeCommitment"] = extractHex(data["dispute_commitment"] ?? data["disputeCommitment"]);
      break;
    }

    case "ResolutionSubmitted": {
      eventType = "ResolutionSubmitted";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["resolver"] = String(data["resolver"] ?? "");
      payload["resolutionCommitment"] = extractHex(data["resolution_commitment"] ?? data["resolutionCommitment"]);
      break;
    }

    case "DisputeResolved": {
      eventType = "DisputeResolved";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["resolutionCommitment"] = extractHex(data["resolution_commitment"] ?? data["resolutionCommitment"]);
      break;
    }

    case "DisputeExpired": {
      eventType = "DisputeExpired";
      caseId = extractCaseId(raw.topic[1]);
      let expLedger = 0;
      let closedLedger = 0;
      if (Array.isArray(raw.value)) {
        expLedger = Number(raw.value[0] ?? 0);
        closedLedger = Number(raw.value[1] ?? 0);
      } else if (raw.value && typeof raw.value === "object") {
        const data = raw.value as Record<string, unknown>;
        expLedger = Number(data["expiration_ledger"] ?? data["expirationLedger"] ?? 0);
        closedLedger = Number(data["closed_at_ledger"] ?? data["closedAtLedger"] ?? 0);
      }
      payload["caseId"] = caseId;
      payload["expirationLedger"] = expLedger;
      payload["closedAtLedger"] = closedLedger || raw.ledger;
      break;
    }

    case "CaseQuorumSet": {
      eventType = "CaseQuorumSet";
      caseId = extractCaseId(raw.topic[1]);
      let quorum = 1;
      if (typeof raw.value === "number") {
        quorum = raw.value;
      } else if (Array.isArray(raw.value)) {
        quorum = Number(raw.value[0] ?? 1);
      } else if (raw.value && typeof raw.value === "object") {
        const data = raw.value as Record<string, unknown>;
        quorum = Number(data["quorum"] ?? 1);
      }
      payload["caseId"] = caseId;
      payload["quorum"] = quorum;
      break;
    }

    case "CaseFinalized": {
      eventType = "CaseFinalized";
      caseId = extractCaseId(raw.topic[1]);
      const data = (raw.value ?? {}) as Record<string, unknown>;
      payload["caseId"] = caseId;
      payload["finalizedAtLedger"] = Number(data["finalized_at_ledger"] ?? data["finalizedAtLedger"] ?? 0);
      break;
    }

    default:
      return null;
  }

  return {
    type: eventType,
    contractId,
    ledger,
    txHash,
    cursor,
    topicXdr,
    dataXdr,
    caseId,
    payload,
  };
}

function extractCaseId(val: unknown): string {
  if (typeof val === "string") {
    return val.toLowerCase();
  }
  if (val && typeof val === "object" && Buffer.isBuffer(val)) {
    return (val as Buffer).toString("hex").toLowerCase();
  }
  return String(val ?? "").toLowerCase();
}

function extractHex(val: unknown): string {
  if (typeof val === "string") {
    return val.toLowerCase();
  }
  if (val && typeof val === "object" && Buffer.isBuffer(val)) {
    return (val as Buffer).toString("hex").toLowerCase();
  }
  return String(val ?? "").toLowerCase();
}
