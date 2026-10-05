import { z } from "zod";
import {
  Bytes32HexSchema,
  StellarAddressSchema,
  DecimalAmountSchema,
} from "@stellarclear/schemas";
import { formatDomainDocument, sha256Hex, computeResolutionCommitment } from "@stellarclear/proof";
import type {
  CaseRepository,
  DisputeRepository,
  ResolutionRepository,
  DisputeExpirationRepository,
} from "@stellarclear/db";
import type { OnChainAnchorService } from "./settlement.js";

const DISPUTE_DOMAIN_PREFIX = "STELLARCLEAR/DISPUTE/V1";

export const OpenDisputeRequestSchema = z.object({
  initiator: StellarAddressSchema,
  reason: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).optional(),
});
export type OpenDisputeRequest = z.infer<typeof OpenDisputeRequestSchema>;

export const SubmitResolutionRequestSchema = z.object({
  resolver: StellarAddressSchema,
  resolutionType: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  agreedAmount: DecimalAmountSchema.optional(),
  resolutionCommitment: Bytes32HexSchema.optional(),
});
export type SubmitResolutionRequest = z.infer<typeof SubmitResolutionRequestSchema>;

export interface DisputeDetails {
  caseId: string;
  /** Current durable case status from the database. */
  status: string;
  /** Authoritative dispute lifecycle state. */
  disputeState: string;
  dispute?: {
    initiator: string;
    reason: string;
    disputeCommitment: string;
    disputeTxHash?: string;
    openedAt: string;
  };
  /** Single resolution representation when mutual resolution has occurred. */
  resolution?: {
    resolver: string;
    resolutionType?: string;
    resolutionCommitment: string;
    resolutionTxHash?: string;
    resolvedAt: string;
  };
  /**
   * Array of all resolution commitments submitted so far.
   * The case only becomes RESOLVED when the indexer observes a DisputeResolved
   * event on-chain (i.e. when BOTH owner and counterparty submit matching
   * commitments). Until then the status remains DISPUTED.
   */
  resolutions: Array<{
    resolver: string;
    resolutionType?: string;
    resolutionCommitment: string;
    resolutionTxHash?: string;
    submittedAt: string;
  }>;
  /** Primary dispute commitment hash, if disputed. */
  disputeCommitment?: string | null;
  /** All resolution commitments submitted by participants. */
  resolutionCommitmentsObserved: string[];
  /** True only when the database status is RESOLVED (set by the indexer). */
  mutualResolutionAchieved: boolean;
  /** Expiration ledger sequence from on-chain state or event, if known. */
  expiryLedger?: number | null;
  /** Expiration lifecycle state classification. */
  expirationState?: "ACTIVE" | "EXPIRED" | "NOT_DISPUTED" | "RESOLVED" | "UNKNOWN";
  /** Ledger sequence where dispute expired, if expired. */
  expiredAtLedger?: number | null;
}

/**
 * Manages dispute opening and resolution submission for settlement cases.
 *
 * Key invariants:
 * - Disputes can only be opened when the authoritative case status is BREAK.
 * - The database is updated ONLY after the on-chain transaction succeeds.
 * - All dispute and resolution evidence is persisted to the database so it
 *   survives process restarts (no in-memory Maps used for durable state).
 * - A case is NOT marked RESOLVED by this service. RESOLVED status is set
 *   exclusively by the indexer when it observes a DisputeResolved on-chain
 *   event (which fires only when BOTH parties submit matching commitments).
 */
export class DisputeService {
  constructor(
    private readonly caseRepo: CaseRepository,
    private readonly disputeRepo: DisputeRepository,
    private readonly resolutionRepo: ResolutionRepository,
    private readonly anchorService: OnChainAnchorService,
    private readonly network: string,
    private readonly disputeExpirationRepo?: DisputeExpirationRepository
  ) {}

  /**
   * Opens a dispute for a case that is in BREAK status.
   *
   * Processing order (must be preserved):
   * 1. Load case — fail fast if not found.
   * 2. Validate case status is BREAK (only valid transition).
   * 3. Validate input via Zod schema (done in the route handler).
   * 4. Compute canonical dispute commitment.
   * 5. Submit on-chain transaction.
   * 6. Confirm transaction success (throws on failure).
   * 7. Persist durable off-chain state to the database.
   * 8. Return response.
   */
  public async openDispute(caseId: string, req: OpenDisputeRequest) {
    // Step 1: Load case
    const existingCase = await this.caseRepo.findById(caseId, this.network);
    if (!existingCase) {
      throw new Error(`Case ${caseId} not found`);
    }

    // Step 2: Validate case status — BREAK is the ONLY valid status for dispute opening.
    // The on-chain contract enforces the same rule. Accepting OPEN or OBSERVED would
    // cause the on-chain call to fail with InvalidState and leave the DB in an
    // inconsistent state if we had already written to it.
    if (existingCase.status !== "BREAK") {
      throw new Error(
        `INVALID_STATE: Cannot open dispute on case ${caseId}. ` +
        `Current status is ${existingCase.status}; disputes may only be opened from BREAK status.`
      );
    }

    // Step 4: Compute canonical dispute commitment
    const disputeCommitment = sha256Hex(
      formatDomainDocument(DISPUTE_DOMAIN_PREFIX, {
        caseId,
        initiator: req.initiator,
        reason: req.reason,
        evidence: req.evidence ?? null,
      })
    );

    // Step 5 & 6: Submit on-chain — throws if transaction fails, preventing any DB write
    const anchorResult = await this.anchorService.anchorDispute({
      initiator: req.initiator,
      caseId,
      disputeCommitment,
    });

    const now = new Date().toISOString();

    // Step 7: Persist durable off-chain state — only reaches here if on-chain succeeded
    await this.caseRepo.updateStatus(caseId, this.network, "DISPUTED");
    await this.caseRepo.updateChainReferences(caseId, this.network, {
      dispute_tx_hash: anchorResult.txHash,
    });
    await this.disputeRepo.insert({
      network: this.network,
      case_id: caseId,
      initiator: req.initiator,
      dispute_commitment: disputeCommitment,
      reason: req.reason,
      tx_hash: anchorResult.txHash,
      opened_at_ledger: anchorResult.ledger ?? null,
    });

    return {
      caseId,
      status: "DISPUTED",
      disputeCommitment,
      txHash: anchorResult.txHash,
      openedAt: now,
    };
  }

  /**
   * Submits a resolution commitment for a disputed case.
   *
   * Important: This method does NOT mark the case RESOLVED. The contract
   * only transitions DISPUTED → RESOLVED when BOTH owner and counterparty
   * submit matching resolution commitments. That transition is observed by
   * the indexer via the DisputeResolved event, which then updates the DB.
   *
   * This method:
   * - Remains DISPUTED after the first resolution submission
   * - Persists the submitted resolver/commitment durably
   * - Returns `mutualResolutionAchieved: false` until the indexer updates the DB
   */
  public async submitResolution(caseId: string, req: SubmitResolutionRequest) {
    // Step 1: Load case
    const existingCase = await this.caseRepo.findById(caseId, this.network);
    if (!existingCase) {
      throw new Error(`Case ${caseId} not found`);
    }

    // Step 2: Validate case status
    if (existingCase.status !== "DISPUTED") {
      throw new Error(
        `INVALID_STATE: Cannot submit resolution on case ${caseId}. ` +
        `Current status is ${existingCase.status}; resolutions may only be submitted from DISPUTED status.`
      );
    }

    // Step 4: Compute canonical resolution commitment
    const resolutionCommitment =
      req.resolutionCommitment ??
      computeResolutionCommitment({
        caseId,
        resolver: req.resolver,
        resolutionType: req.resolutionType,
        agreedAmount: req.agreedAmount ?? null,
        details: req.details ?? null,
      });

    // Step 5 & 6: Submit on-chain — throws if transaction fails
    const anchorResult = await this.anchorService.anchorResolution({
      resolver: req.resolver,
      caseId,
      resolutionCommitment,
    });

    // Step 7: Persist resolution evidence — case status stays DISPUTED.
    // The indexer will update the DB to RESOLVED when it observes a
    // DisputeResolved event, which the contract emits only when both parties
    // have submitted matching commitments.
    await this.caseRepo.updateChainReferences(caseId, this.network, {
      resolution_tx_hash: anchorResult.txHash,
    });
    await this.resolutionRepo.insert({
      network: this.network,
      case_id: caseId,
      resolver: req.resolver,
      resolution_commitment: resolutionCommitment,
      resolution_type: req.resolutionType,
      tx_hash: anchorResult.txHash,
      submitted_at_ledger: anchorResult.ledger ?? null,
    });

    // Check if both parties have submitted matching commitments
    const resolutions = await this.resolutionRepo.findByCaseId(caseId, this.network);
    const ownerRes = resolutions.find((r) => r.resolver === existingCase.owner);
    const cpRes = existingCase.counterparty
      ? resolutions.find((r) => r.resolver === existingCase.counterparty)
      : null;

    let currentStatus: string = existingCase.status;
    const isMutual = Boolean(
      ownerRes &&
      cpRes &&
      ownerRes.resolution_commitment.toLowerCase() === cpRes.resolution_commitment.toLowerCase()
    );

    if (isMutual) {
      await this.caseRepo.updateStatus(caseId, this.network, "RESOLVED");
      currentStatus = "RESOLVED";
    } else {
      const refreshedCase = await this.caseRepo.findById(caseId, this.network);
      currentStatus = refreshedCase?.status ?? existingCase.status;
    }

    const now = new Date().toISOString();
    return {
      caseId,
      // Return the current DB status — DISPUTED unless the indexer has already
      // observed the DisputeResolved on-chain event.
      status: currentStatus,
      resolutionCommitment,
      txHash: anchorResult.txHash,
      submittedAt: now,
      // Reflect whether mutual resolution has actually occurred on-chain.
      mutualResolutionAchieved: currentStatus === "RESOLVED",
    };
  }

  /**
   * Returns dispute and resolution details reconstructed entirely from the
   * database. Never uses in-memory Maps so the data survives restarts.
   */
  public async getDispute(caseId: string): Promise<DisputeDetails> {
    const existingCase = await this.caseRepo.findById(caseId, this.network);
    if (!existingCase) {
      throw new Error(`Case ${caseId} not found`);
    }

    // Reconstruct from DB — no in-memory Maps
    const disputeRows = await this.disputeRepo.findByCaseId(caseId, this.network);
    const resolutionRows = await this.resolutionRepo.findByCaseId(caseId, this.network);
    const expirationRecord = this.disputeExpirationRepo
      ? await this.disputeExpirationRepo.findByCaseId(caseId, this.network)
      : null;

    const disputeRow = disputeRows[0];
    const resolutions = resolutionRows.map((r) => ({
      resolver: r.resolver,
      resolutionType: r.resolution_type ?? undefined,
      resolutionCommitment: r.resolution_commitment,
      resolutionTxHash: r.tx_hash ?? existingCase.resolution_tx_hash ?? undefined,
      submittedAt:
        typeof r.created_at === "string"
          ? r.created_at
          : r.created_at
          ? new Date(r.created_at).toISOString()
          : new Date().toISOString(),
    }));

    // Backwards-compatible resolution object (populated when resolved or resolution exists)
    let resolution: DisputeDetails["resolution"] = undefined;
    if (resolutions.length > 0) {
      const targetRes = resolutions[resolutions.length - 1];
      resolution = {
        resolver: targetRes.resolver,
        resolutionType: targetRes.resolutionType,
        resolutionCommitment: targetRes.resolutionCommitment,
        resolutionTxHash: targetRes.resolutionTxHash,
        resolvedAt: targetRes.submittedAt,
      };
    }

    let expirationState: DisputeDetails["expirationState"] = "NOT_DISPUTED";
    if (expirationRecord) {
      expirationState = "EXPIRED";
    } else if (existingCase.status === "DISPUTED") {
      expirationState = "ACTIVE";
    } else if (existingCase.status === "RESOLVED") {
      expirationState = "RESOLVED";
    }

    const expiryLedger =
      expirationRecord?.expired_at_ledger ??
      (existingCase.dispute_expires_at_ledger
        ? Number(existingCase.dispute_expires_at_ledger)
        : null);

    return {
      caseId,
      status: existingCase.status,
      disputeState: existingCase.status,
      dispute: disputeRow
        ? {
            initiator: disputeRow.initiator,
            reason: disputeRow.reason ?? "Dispute opened",
            disputeCommitment: disputeRow.dispute_commitment,
            disputeTxHash: disputeRow.tx_hash ?? existingCase.dispute_tx_hash ?? undefined,
            openedAt:
              typeof disputeRow.created_at === "string"
                ? disputeRow.created_at
                : disputeRow.created_at
                ? new Date(disputeRow.created_at).toISOString()
                : new Date().toISOString(),
          }
        : undefined,
      resolution,
      resolutions,
      disputeCommitment: disputeRow?.dispute_commitment ?? null,
      resolutionCommitmentsObserved: resolutions.map((r) => r.resolutionCommitment),
      mutualResolutionAchieved: existingCase.status === "RESOLVED",
      expiryLedger,
      expirationState,
      expiredAtLedger: expirationRecord?.expired_at_ledger ?? null,
    };
  }
}
