function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

import {
  CreateCaseRequestSchema,
  SubmitObservationRequestSchema,
  VerifyProofRequestSchema,
  Bytes32HexSchema,
  type ExpectedSettlement,
  type ObservedSettlement,
  type Attestation,
  type Break,
  type ReconciliationStatus,
} from "@stellarclear/schemas";
import {
  computeTermsCommitment,
  computeObservationCommitment,
  createSettlementProof,
  verifySettlementProof,
} from "@stellarclear/proof";
import { reconcileSettlement } from "@stellarclear/matcher";
import type { IDatabaseClient } from "@stellarclear/db";
import {
  CaseRepository,
  ObservationRepository,
  ReconciliationRepository,
  BreakRepository,
  AttestationRepository,
  DisputeRepository,
  ResolutionRepository,
  DisputeExpirationRepository,
} from "@stellarclear/db";
import { validateApiConfig, type ApiConfig, type ApiConfigInput } from "./config.js";
import type { HttpRequest, HttpResponse, VersionResponse } from "./types.js";
import { SETTLEMENT_REGISTRY_RELEASE, verifyContractReleaseCompatibility } from "@stellarclear/sdk";
import { SorobanSettlementAnchor, type OnChainAnchorService } from "./settlement.js";
import { SorobanChainVerifier } from "./chain-verifier.js";
import { AttestationService, SubmitAttestationRequestSchema } from "./attestations.js";
import {
  DisputeService,
  OpenDisputeRequestSchema,
  SubmitResolutionRequestSchema,
} from "./disputes.js";
import { FinalizationService } from "./finalization.js";
import { SettlementConsistencyChecker } from "./consistency.js";
import { SettlementAuditService } from "./audit.js";
import { IdempotencyManager } from "./idempotency.js";
import { ReadinessChecker } from "./readiness.js";
import { formatApiError } from "./errors.js";
import { validatePayloadSize } from "./validation.js";
import { SettlementDiagnosticsService } from "./operations.js";

export interface InjectOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export class ApiServer {
  public readonly config: ApiConfig;
  private caseRepo: CaseRepository;
  private obsRepo: ObservationRepository;
  private recRepo: ReconciliationRepository;
  private breakRepo: BreakRepository;
  private attestationRepo: AttestationRepository;
  public readonly disputeRepo: DisputeRepository;
  public readonly resolutionRepo: ResolutionRepository;
  public readonly disputeExpirationRepo: DisputeExpirationRepository;
  public readonly anchorService: OnChainAnchorService;
  public readonly chainVerifier: SorobanChainVerifier;
  public readonly attestationService: AttestationService;
  public readonly disputeService: DisputeService;
  public readonly finalizationService: FinalizationService;
  public readonly consistencyChecker: SettlementConsistencyChecker;
  public readonly auditService: SettlementAuditService;
  public readonly idempotencyManager: IdempotencyManager;
  public readonly readinessChecker: ReadinessChecker;
  public readonly diagnosticsService: SettlementDiagnosticsService;

  constructor(
    configInput: ApiConfigInput | ApiConfig,
    public readonly dbClient: IDatabaseClient,
    anchorService?: OnChainAnchorService,
    chainVerifier?: SorobanChainVerifier
  ) {
    this.config = validateApiConfig(configInput);
    this.caseRepo = new CaseRepository(dbClient);
    this.obsRepo = new ObservationRepository(dbClient);
    this.recRepo = new ReconciliationRepository(dbClient);
    this.breakRepo = new BreakRepository(dbClient);
    this.attestationRepo = new AttestationRepository(dbClient);
    this.disputeRepo = new DisputeRepository(dbClient);
    this.resolutionRepo = new ResolutionRepository(dbClient);
    this.disputeExpirationRepo = new DisputeExpirationRepository(dbClient);
    this.anchorService = anchorService ?? new SorobanSettlementAnchor();
    this.chainVerifier =
      chainVerifier ??
      new SorobanChainVerifier(undefined, this.config.contractId, this.config.network);
    this.attestationService = new AttestationService(
      this.caseRepo,
      this.attestationRepo,
      this.anchorService,
      this.config.network
    );
    this.disputeService = new DisputeService(
      this.caseRepo,
      this.disputeRepo,
      this.resolutionRepo,
      this.anchorService,
      this.config.network,
      this.disputeExpirationRepo
    );
    this.finalizationService = new FinalizationService(
      this.caseRepo,
      this.anchorService,
      this.config.network
    );
    this.consistencyChecker = new SettlementConsistencyChecker(
      this.caseRepo,
      this.obsRepo,
      this.anchorService,
      this.config.contractId,
      this.config.network
    );
    this.auditService = new SettlementAuditService(
      this.caseRepo,
      this.obsRepo,
      this.recRepo,
      this.breakRepo,
      this.attestationRepo,
      this.disputeService,
      this.anchorService,
      this.config.contractId,
      this.config.network
    );
    this.idempotencyManager = new IdempotencyManager();
    this.readinessChecker = new ReadinessChecker(this.config, this.dbClient, this.anchorService);
    this.diagnosticsService = new SettlementDiagnosticsService(this.config, this.dbClient, this.anchorService);
  }

  /**
   * Public request dispatcher with idempotency middleware and payload security.
   */
  public async handleRequest(req: HttpRequest): Promise<HttpResponse> {
    const requestId = req.requestId || (req.headers["x-request-id"] as string) || generateUuid();

    // Enforce payload size limit
    if (!validatePayloadSize(req.body)) {
      return this.errorResponse(413, "PAYLOAD_TOO_LARGE", "Request payload exceeds maximum allowed size (1 MB)", requestId);
    }

    const rawIdempotency = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const idempotencyKey =
      typeof rawIdempotency === "string"
        ? rawIdempotency
        : Array.isArray(rawIdempotency)
        ? rawIdempotency[0]
        : undefined;
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    if (idempotencyKey) {
      const validation = this.idempotencyManager.validateKey(idempotencyKey);
      if (!validation.valid) {
        return this.errorResponse(400, "MALFORMED_REQUEST", validation.error || "Invalid Idempotency-Key format", requestId);
      }

      if (method !== "GET") {
        const evaluation = this.idempotencyManager.evaluate(method, pathname, idempotencyKey, req.body);
        if (evaluation.status === "CONFLICT") {
          return this.errorResponse(409, "IDEMPOTENCY_CONFLICT", evaluation.message, requestId);
        }
        if (evaluation.status === "HIT") {
          return {
            ...evaluation.response,
            headers: {
              ...evaluation.response.headers,
              "x-request-id": requestId,
            },
          };
        }
      }
    }

    const res = await this.dispatchRequest(req, url, pathname, method, requestId);
    if (idempotencyKey && method !== "GET" && res.statusCode >= 200 && res.statusCode < 400) {
      this.idempotencyManager.set(method, pathname, idempotencyKey, req.body, res);
    }
    return res;
  }

  /**
   * Internal request dispatcher executing routing and handler logic.
   */
  private async dispatchRequest(
    req: HttpRequest,
    url: URL,
    pathname: string,
    method: string,
    requestId: string
  ): Promise<HttpResponse> {
    try {
      // 1. GET /health
      if (method === "GET" && pathname === "/health") {
        const health = this.readinessChecker.getHealth();
        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: health,
        };
      }

      // 2. GET /ready
      if (method === "GET" && pathname === "/ready") {
        const ready = await this.readinessChecker.checkReadiness();
        const statusCode = ready.status === "not_ready" ? 503 : 200;
        return {
          statusCode,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: ready,
        };
      }

      // 2b. GET /v1/operations/diagnostics or /v1/diagnostics
      if (method === "GET" && (pathname === "/v1/operations/diagnostics" || pathname === "/v1/diagnostics")) {
        const diagnostics = await this.diagnosticsService.getDiagnostics();
        const statusCode = diagnostics.status === "unhealthy" ? 503 : 200;
        return {
          statusCode,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: diagnostics,
        };
      }

      // 2c. GET /v1/version or /version
      if (method === "GET" && (pathname === "/v1/version" || pathname === "/version")) {
        const compatibility = verifyContractReleaseCompatibility(this.config.network, this.config.contractId);
        const versionResponse: VersionResponse = {
          protocol: "STELLARCLEAR",
          version: "0.1.0",
          releaseTag: "v0.1.0",
          contract: {
            name: SETTLEMENT_REGISTRY_RELEASE.name,
            version: SETTLEMENT_REGISTRY_RELEASE.version,
            releaseTag: SETTLEMENT_REGISTRY_RELEASE.releaseTag,
            wasmHash: SETTLEMENT_REGISTRY_RELEASE.wasmHash,
            specVersion: SETTLEMENT_REGISTRY_RELEASE.specVersion,
            contractId: this.config.contractId,
            network: this.config.network,
            compatible: compatibility.compatible,
            compatibilityReason: compatibility.reason,
          },
          features: SETTLEMENT_REGISTRY_RELEASE.features,
        };
        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: versionResponse,
        };
      }

      // 3. POST /v1/cases
      if (method === "POST" && pathname === "/v1/cases") {
        const parsed = CreateCaseRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", parsed.error.message, requestId, parsed.error.issues);
        }

        const expected: ExpectedSettlement = parsed.data.expected;
        const termsCommitment = computeTermsCommitment(expected);

        // Check if case exists
        const existing = await this.caseRepo.findById(expected.caseId, this.config.network);
        if (existing) {
          return this.errorResponse(409, "CONFLICT", `Case ${expected.caseId} already exists`, requestId);
        }

        const anchorResult = await this.anchorService.anchorCaseCreation(expected);
        const now = new Date();
        await this.caseRepo.insert({
          id: expected.caseId,
          network: this.config.network,
          contract_id: this.config.contractId,
          owner: expected.owner,
          counterparty: expected.counterparty ?? null,
          trade_reference: expected.tradeReference,
          asset: expected.asset,
          amount: expected.amount,
          expected_destination: expected.expectedDestination,
          reference: expected.reference ?? null,
          terms_commitment: termsCommitment,
          expires_at_ledger: expected.deadline,
          status: "OPEN",
          observer_quorum: parsed.data.observerQuorum ?? parsed.data.expected.observerQuorum ?? 1,
          create_tx_hash: anchorResult.txHash,
          submission_status: "CONFIRMED",
          created_at: now,
          updated_at: now,
        });

        return {
          statusCode: 201,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: {
            caseId: expected.caseId,
            status: "OPEN",
            termsCommitment,
            txHash: anchorResult.txHash,
            createdAt: now.toISOString(),
          },
        };
      }

      // 4. GET /v1/cases/:caseId
      const caseMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)$/);
      if (method === "GET" && caseMatch) {
        const rawCaseId = caseMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }

        const caseId = parsedId.data;
        const found = await this.caseRepo.findById(caseId, this.config.network);
        if (!found) {
          return this.errorResponse(404, "NOT_FOUND", `Case ${caseId} not found`, requestId);
        }

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: {
            caseId: found.id,
            network: found.network,
            contractId: found.contract_id ?? this.config.contractId,
            owner: found.owner,
            counterparty: found.counterparty,
            tradeReference: found.trade_reference,
            asset: found.asset,
            amount: found.amount,
            expectedDestination: found.expected_destination,
            reference: found.reference,
            termsCommitment: found.terms_commitment,
            expiresAtLedger: Number(found.expires_at_ledger),
            status: found.status,
            createTxHash: found.create_tx_hash ?? undefined,
            observationTxHash: found.observation_tx_hash ?? undefined,
            reconciliationTxHash: found.reconciliation_tx_hash ?? undefined,
            attestationTxHash: found.attestation_tx_hash ?? undefined,
            disputeTxHash: found.dispute_tx_hash ?? undefined,
            resolutionTxHash: found.resolution_tx_hash ?? undefined,
            finalizationTxHash: found.finalization_tx_hash ?? undefined,
            submissionStatus: found.submission_status ?? undefined,
            confirmedAtLedger: found.confirmed_at_ledger ? Number(found.confirmed_at_ledger) : undefined,
            createdAtLedger: found.created_at_ledger ? Number(found.created_at_ledger) : undefined,
            finalizedAtLedger: found.finalized_at_ledger ? Number(found.finalized_at_ledger) : undefined,
            observerQuorum: Number(found.observer_quorum ?? 1),
            createdAt: new Date(found.created_at).toISOString(),
            updatedAt: new Date(found.updated_at).toISOString(),
          },
        };
      }

      // 4a. GET /v1/cases/:caseId/onchain
      const onChainMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/onchain$/);
      if (method === "GET" && onChainMatch) {
        const rawCaseId = onChainMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        const found = await this.caseRepo.findById(caseId, this.config.network);
        const onChainCase = await this.anchorService.getOnChainCase(caseId);

        if (!found && !onChainCase) {
          return this.errorResponse(404, "NOT_FOUND", `Case ${caseId} not found on-chain or in database`, requestId);
        }

        const now = new Date().toISOString();
        if (onChainCase) {
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: {
              caseId,
              contractId: this.config.contractId,
              network: this.config.network,
              status: onChainCase.status,
              owner: onChainCase.owner,
              counterparty: onChainCase.counterparty,
              termsCommitment: onChainCase.termsCommitment,
              expiresAtLedger: onChainCase.expiresAtLedger,
              createdAtLedger: onChainCase.createdAtLedger,
              finalizedAtLedger: onChainCase.finalizedAtLedger,
              observation: onChainCase.observation,
              decision: onChainCase.decision,
              transactionHashes: {
                createTxHash: found?.create_tx_hash ?? undefined,
                observationTxHash: found?.observation_tx_hash ?? undefined,
                reconciliationTxHash: found?.reconciliation_tx_hash ?? undefined,
                attestationTxHash: found?.attestation_tx_hash ?? undefined,
                disputeTxHash: found?.dispute_tx_hash ?? undefined,
                resolutionTxHash: found?.resolution_tx_hash ?? undefined,
                finalizationTxHash: found?.finalization_tx_hash ?? undefined,
              },
              fetchedAt: now,
            },
          };
        } else {
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: {
              caseId,
              contractId: found!.contract_id ?? this.config.contractId,
              network: found!.network,
              status: found!.status,
              owner: found!.owner,
              counterparty: found!.counterparty ?? undefined,
              termsCommitment: found!.terms_commitment,
              expiresAtLedger: Number(found!.expires_at_ledger),
              createdAtLedger: found!.created_at_ledger ? Number(found!.created_at_ledger) : undefined,
              finalizedAtLedger: found!.finalized_at_ledger ? Number(found!.finalized_at_ledger) : undefined,
              transactionHashes: {
                createTxHash: found!.create_tx_hash ?? undefined,
                observationTxHash: found!.observation_tx_hash ?? undefined,
                reconciliationTxHash: found!.reconciliation_tx_hash ?? undefined,
                attestationTxHash: found!.attestation_tx_hash ?? undefined,
                disputeTxHash: found!.dispute_tx_hash ?? undefined,
                resolutionTxHash: found!.resolution_tx_hash ?? undefined,
                finalizationTxHash: found!.finalization_tx_hash ?? undefined,
              },
              decision: {
                type: found!.status === "MATCHED" ? "MATCHED" : found!.status === "BREAK" ? "BREAK" : "NONE",
              },
              fetchedAt: now,
            },
          };
        }
      }

      // 4b. GET /v1/cases/:caseId/history
      const historyMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/history$/);
      if (method === "GET" && historyMatch) {
        const rawCaseId = historyMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        const found = await this.caseRepo.findById(caseId, this.config.network);
        if (!found) {
          return this.errorResponse(404, "NOT_FOUND", `Case ${caseId} not found`, requestId);
        }

        const obs = await this.obsRepo.findByCaseId(caseId, this.config.network);
        const rec = await this.recRepo.findByCaseId(caseId, this.config.network);
        const rawAttestations = await this.attestationRepo.listByCaseId(caseId, this.config.network);
        const disputeInfo = await this.disputeService.getDispute(caseId).catch(() => null);

        const history: unknown[] = [];

        // 1. Case Created
        history.push({
          event: "CASE_CREATED",
          status: "OPEN",
          timestamp: new Date(found.created_at).toISOString(),
          ledger: found.created_at_ledger ? Number(found.created_at_ledger) : undefined,
          txHash: found.create_tx_hash ?? undefined,
          actor: found.owner,
          details: {
            tradeReference: found.trade_reference,
            asset: found.asset,
            amount: found.amount,
            termsCommitment: found.terms_commitment,
          },
        });

        // 2. Observation
        if (obs) {
          history.push({
            event: "OBSERVED",
            status: "OBSERVED",
            timestamp: typeof obs.observed_at === "string" ? obs.observed_at : obs.observed_at.toISOString(),
            ledger: Number(obs.observed_ledger),
            txHash: obs.tx_hash,
            details: {
              asset: obs.asset,
              amount: obs.amount,
              destination: obs.destination,
              status: obs.status,
            },
          });
        }

        // 3. Reconciliation
        if (rec) {
          history.push({
            event: rec.matched ? "MATCHED" : "BREAK_RECORDED",
            status: rec.status,
            timestamp: typeof rec.reconciled_at === "string" ? rec.reconciled_at : rec.reconciled_at.toISOString(),
            ledger: rec.confirmed_at_ledger ? Number(rec.confirmed_at_ledger) : undefined,
            txHash: rec.reconciliation_tx_hash ?? undefined,
            details: {
              matched: rec.matched,
            },
          });
        }

        // 4. Attestations
        for (const att of rawAttestations) {
          history.push({
            event: "ATTESTED",
            status: found.status,
            timestamp: typeof att.created_at === "string" ? att.created_at : att.created_at ? new Date(att.created_at).toISOString() : new Date().toISOString(),
            ledger: Number(att.attested_at_ledger),
            txHash: found.attestation_tx_hash ?? undefined,
            actor: att.attestor,
            details: {
              role: att.role,
              commitment: att.commitment,
            },
          });
        }

        // 5. Dispute & Resolution
        if (disputeInfo?.dispute) {
          history.push({
            event: "DISPUTED",
            status: "DISPUTED",
            timestamp: disputeInfo.dispute.openedAt,
            txHash: disputeInfo.dispute.disputeTxHash,
            actor: disputeInfo.dispute.initiator,
            details: {
              reason: disputeInfo.dispute.reason,
              disputeCommitment: disputeInfo.dispute.disputeCommitment,
            },
          });
        }
        if (disputeInfo?.resolution) {
          history.push({
            event: "RESOLVED",
            status: "RESOLVED",
            timestamp: disputeInfo.resolution.resolvedAt,
            txHash: disputeInfo.resolution.resolutionTxHash,
            actor: disputeInfo.resolution.resolver,
            details: {
              resolutionType: disputeInfo.resolution.resolutionType,
              resolutionCommitment: disputeInfo.resolution.resolutionCommitment,
            },
          });
        }

        // 6. Finalization
        if (found.status === "FINALIZED") {
          history.push({
            event: "FINALIZED",
            status: "FINALIZED",
            timestamp: new Date(found.updated_at).toISOString(),
            ledger: found.finalized_at_ledger ? Number(found.finalized_at_ledger) : undefined,
            txHash: found.finalization_tx_hash ?? undefined,
          });
        }

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: {
            caseId,
            currentStatus: found.status,
            contractId: found.contract_id ?? this.config.contractId,
            network: found.network,
            history,
            retrievedAt: new Date().toISOString(),
          },
        };
      }

      // 4c. GET /v1/cases/:caseId/consistency
      const consistencyMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/consistency$/);
      if (method === "GET" && consistencyMatch) {
        const rawCaseId = consistencyMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        try {
          const result = await this.consistencyChecker.checkCaseConsistency(caseId);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          throw err;
        }
      }

      // 4d. GET /v1/cases/:caseId/audit
      const auditMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/audit$/);
      if (method === "GET" && auditMatch) {
        const rawCaseId = auditMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        try {
          const result = await this.auditService.getAuditHistory(caseId);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          throw err;
        }
      }

      // 5. POST /v1/cases/:caseId/observe
      const observeMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/observe$/);
      if (method === "POST" && observeMatch) {
        const rawCaseId = observeMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }

        const caseId = parsedId.data;
        const found = await this.caseRepo.findById(caseId, this.config.network);
        if (!found) {
          return this.errorResponse(404, "NOT_FOUND", `Case ${caseId} not found`, requestId);
        }

        const parsedBody = SubmitObservationRequestSchema.safeParse(req.body);
        if (!parsedBody.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", parsedBody.error.message, requestId, parsedBody.error.issues);
        }

        const obs: ObservedSettlement = parsedBody.data.observation;
        const obsCommitment = computeObservationCommitment(obs);

        const existingObs = await this.obsRepo.findByCaseId(caseId, this.config.network);
        if (existingObs && existingObs.tx_hash.toLowerCase() === obs.txHash.toLowerCase()) {
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: {
              caseId,
              status: found.status,
              txHash: existingObs.observation_tx_hash ?? existingObs.tx_hash,
              observedAt:
                typeof existingObs.observed_at === "string"
                  ? existingObs.observed_at
                  : existingObs.observed_at.toISOString(),
            },
          };
        }

        const anchorResult = await this.anchorService.anchorObservation({
          observer: obs.destination,
          caseId,
          observation: obs,
        });

        await this.obsRepo.insert({
          network: this.config.network,
          case_id: caseId,
          observer: obs.destination,
          tx_hash: obs.txHash,
          observed_ledger: obs.ledger,
          observation_commitment: obsCommitment,
          observation_tx_hash: anchorResult.txHash,
          asset: obs.asset,
          amount: obs.amount,
          destination: obs.destination,
          reference: obs.reference ?? null,
          status: obs.status,
          observed_at: obs.observedAt,
        });

        await this.caseRepo.updateStatus(caseId, this.config.network, "OBSERVED");
        await this.caseRepo.updateChainReferences(caseId, this.config.network, {
          observation_tx_hash: anchorResult.txHash,
        });

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: {
            caseId,
            status: "OBSERVED",
            observationCommitment: obsCommitment,
            txHash: anchorResult.txHash,
            observedAt: obs.observedAt,
          },
        };
      }

      // 6. POST /v1/cases/:caseId/reconcile
      const reconcileMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/reconcile$/);
      if (method === "POST" && reconcileMatch) {
        const rawCaseId = reconcileMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }

        const caseId = parsedId.data;
        const found = await this.caseRepo.findById(caseId, this.config.network);
        if (!found) {
          return this.errorResponse(404, "NOT_FOUND", `Case ${caseId} not found`, requestId);
        }

        const obs = await this.obsRepo.findByCaseId(caseId, this.config.network);
        const expected: ExpectedSettlement = {
          caseId: found.id,
          tradeReference: found.trade_reference,
          asset: found.asset,
          amount: found.amount,
          expectedDestination: found.expected_destination,
          reference: found.reference ?? undefined,
          deadline: Number(found.expires_at_ledger),
          owner: found.owner,
          counterparty: found.counterparty ?? undefined,
        };

        const observed: ObservedSettlement | undefined = obs
          ? {
              txHash: obs.tx_hash,
              ledger: Number(obs.observed_ledger),
              asset: obs.asset,
              amount: obs.amount,
              destination: obs.destination,
              reference: obs.reference ?? undefined,
              status: obs.status,
              observedAt: typeof obs.observed_at === "string" ? obs.observed_at : obs.observed_at.toISOString(),
            }
          : undefined;

        const result = reconcileSettlement(expected, observed);
        const anchorResult = await this.anchorService.anchorReconciliation({
          observer: expected.owner,
          caseId,
          status: result.status,
          breakCode: result.breaks[0]?.code,
        });

        // Persist reconciliation and breaks
        const recRecord = await this.recRepo.insert({
          network: this.config.network,
          case_id: caseId,
          status: result.status,
          matched: result.matched,
          reconciliation_tx_hash: anchorResult.txHash,
          reconciled_at: result.reconciledAt,
        });

        if (result.breaks.length > 0) {
          await this.breakRepo.insertMany(
            result.breaks.map((b: Break) => ({
              network: this.config.network,
              case_id: caseId,
              reconciliation_id: recRecord.id,
              code: b.code,
              field: b.field,
              expected_value: b.expectedValue,
              observed_value: b.observedValue,
              message: b.message,
            }))
          );
        }

        await this.caseRepo.updateStatus(caseId, this.config.network, result.status);
        await this.caseRepo.updateChainReferences(caseId, this.config.network, {
          reconciliation_tx_hash: anchorResult.txHash,
        });

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: {
            ...result,
            txHash: anchorResult.txHash,
          },
        };
      }

      // 7. GET /v1/cases/:caseId/breaks
      const breaksMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/breaks$/);
      if (method === "GET" && breaksMatch) {
        const rawCaseId = breaksMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }

        const caseId = parsedId.data;
        const found = await this.caseRepo.findById(caseId, this.config.network);
        if (!found) {
          return this.errorResponse(404, "NOT_FOUND", `Case ${caseId} not found`, requestId);
        }

        const breaks = await this.breakRepo.findByCaseId(caseId, this.config.network);

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: {
            caseId,
            breaks: breaks.map((b) => ({
              code: b.code,
              field: b.field,
              expectedValue: b.expected_value ?? undefined,
              observedValue: b.observed_value ?? undefined,
              message: b.message,
            })),
          },
        };
      }

      // 8. GET /v1/cases/:caseId/proof
      const proofMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/proof$/);
      if (method === "GET" && proofMatch) {
        const rawCaseId = proofMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }

        const caseId = parsedId.data;
        const found = await this.caseRepo.findById(caseId, this.config.network);
        if (!found) {
          return this.errorResponse(404, "NOT_FOUND", `Case ${caseId} not found`, requestId);
        }

        const obs = await this.obsRepo.findByCaseId(caseId, this.config.network);
        if (!obs) {
          return this.errorResponse(400, "PROOF_NOT_AVAILABLE", `Observation not recorded yet for case ${caseId}`, requestId);
        }

        const rawAttestations = await this.attestationRepo.listByCaseId(caseId, this.config.network);
        const attestations: Attestation[] = rawAttestations.map((a) => ({
          caseId: a.case_id,
          role: a.role as "OWNER" | "COUNTERPARTY" | "OBSERVER",
          attestor: a.attestor,
          commitment: a.commitment,
          attestedAtLedger: Number(a.attested_at_ledger),
        }));

        const expected: ExpectedSettlement = {
          caseId: found.id,
          tradeReference: found.trade_reference,
          asset: found.asset,
          amount: found.amount,
          expectedDestination: found.expected_destination,
          reference: found.reference ?? undefined,
          deadline: Number(found.expires_at_ledger),
          owner: found.owner,
          counterparty: found.counterparty ?? undefined,
        };

        const observed: ObservedSettlement = {
          txHash: obs.tx_hash,
          ledger: Number(obs.observed_ledger),
          asset: obs.asset,
          amount: obs.amount,
          destination: obs.destination,
          reference: obs.reference ?? undefined,
          status: obs.status,
          observedAt: typeof obs.observed_at === "string" ? obs.observed_at : obs.observed_at.toISOString(),
        };

        const rec = await this.recRepo.findByCaseId(caseId, this.config.network);
        const resultStatus: ReconciliationStatus =
          (rec && !rec.matched) ||
          found.status === "BREAK" ||
          found.status === "DISPUTED" ||
          found.status === "RESOLVED"
            ? "BREAK"
            : "MATCHED";
        const finalizedLedger = Number(found.finalized_at_ledger ?? obs.observed_ledger ?? found.expires_at_ledger);

        const proof = createSettlementProof({
          caseId,
          terms: expected,
          observation: observed,
          finalizedLedger,
          result: resultStatus,
          attestations,
          contractId: this.config.contractId,
          network: this.config.network,
        });

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: proof,
        };
      }

      // 8a. POST /v1/cases/:caseId/attest
      const attestMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/attest$/);
      if (method === "POST" && attestMatch) {
        const rawCaseId = attestMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        const parsedBody = SubmitAttestationRequestSchema.safeParse(req.body);
        if (!parsedBody.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", parsedBody.error.message, requestId, parsedBody.error.issues);
        }

        try {
          const result = await this.attestationService.submitAttestation(caseId, parsedBody.data);
          return {
            statusCode: 201,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: {
              ...result.attestation,
              txHash: result.txHash,
              recordedAt: new Date().toISOString(),
            },
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          if (message.includes("not the owner") || message.includes("not the counterparty")) {
            return this.errorResponse(403, "FORBIDDEN", message, requestId);
          }
          throw err;
        }
      }

      // 8b. GET /v1/cases/:caseId/attestations
      const attestListMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/attestations$/);
      if (method === "GET" && attestListMatch) {
        const rawCaseId = attestListMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        try {
          const result = await this.attestationService.getAttestations(caseId);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          throw err;
        }
      }

      // 8c. GET /v1/cases/:caseId/quorum
      const quorumMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/quorum$/);
      if (method === "GET" && quorumMatch) {
        const rawCaseId = quorumMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        try {
          const result = await this.attestationService.getQuorumStatus(caseId);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          throw err;
        }
      }

      // 8c. POST /v1/cases/:caseId/dispute
      const disputeMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/dispute$/);
      if (method === "POST" && disputeMatch) {
        const rawCaseId = disputeMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        const parsedBody = OpenDisputeRequestSchema.safeParse(req.body);
        if (!parsedBody.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", parsedBody.error.message, requestId, parsedBody.error.issues);
        }

        try {
          const result = await this.disputeService.openDispute(caseId, parsedBody.data);
          return {
            statusCode: 201,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          if (message.includes("Cannot open dispute") || message.includes("Expected status")) {
            return this.errorResponse(400, "INVALID_STATE", message, requestId);
          }
          throw err;
        }
      }

      // 8d. POST /v1/cases/:caseId/resolve
      const resolveMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/resolve$/);
      if (method === "POST" && resolveMatch) {
        const rawCaseId = resolveMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        const parsedBody = SubmitResolutionRequestSchema.safeParse(req.body);
        if (!parsedBody.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", parsedBody.error.message, requestId, parsedBody.error.issues);
        }

        try {
          const result = await this.disputeService.submitResolution(caseId, parsedBody.data);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          if (message.includes("Cannot submit resolution") || message.includes("Expected status")) {
            return this.errorResponse(400, "INVALID_STATE", message, requestId);
          }
          throw err;
        }
      }

      // 8e. GET /v1/cases/:caseId/dispute
      if (method === "GET" && disputeMatch) {
        const rawCaseId = disputeMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        try {
          const result = await this.disputeService.getDispute(caseId);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          throw err;
        }
      }

      // 8f. POST /v1/cases/:caseId/finalize
      const finalizeMatch = pathname.match(/^\/v1\/cases\/([a-zA-Z0-9_-]+)\/finalize$/);
      if (method === "POST" && finalizeMatch) {
        const rawCaseId = finalizeMatch[1];
        const parsedId = Bytes32HexSchema.safeParse(rawCaseId);
        if (!parsedId.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", "Invalid case ID format", requestId);
        }
        const caseId = parsedId.data;
        try {
          const result = await this.finalizationService.finalizeCase(caseId);
          return {
            statusCode: 200,
            headers: { "content-type": "application/json", "x-request-id": requestId },
            body: result,
          };
        } catch (err: unknown) {
          const message = (err as Error).message;
          if (message.includes("not found")) {
            return this.errorResponse(404, "NOT_FOUND", message, requestId);
          }
          if (message.includes("Cannot finalize case") || message.includes("Expected status")) {
            return this.errorResponse(400, "INVALID_STATE", message, requestId);
          }
          throw err;
        }
      }

      // 9. POST /v1/proofs/verify
      if (method === "POST" && pathname === "/v1/proofs/verify") {
        const parsed = VerifyProofRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", parsed.error.message, requestId, parsed.error.issues);
        }

        const { proof, termsDocument, observedDocument } = parsed.data;
        const verification = verifySettlementProof(proof, {
          terms: termsDocument,
          observation: observedDocument,
          expectedContractId: this.config.contractId,
          expectedNetwork: this.config.network,
        });

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: {
            valid: verification.valid,
            reason: verification.reason,
            recomputedTermsCommitment: verification.recomputedTermsCommitment,
            recomputedObservationCommitment: verification.recomputedObservationCommitment,
            verifiedAt: new Date().toISOString(),
          },
        };
      }

      // 10. POST /v1/proofs/verify/onchain
      if (method === "POST" && pathname === "/v1/proofs/verify/onchain") {
        const parsed = VerifyProofRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return this.errorResponse(400, "VALIDATION_ERROR", parsed.error.message, requestId, parsed.error.issues);
        }

        const { proof, termsDocument, observedDocument } = parsed.data;
        const result = await this.chainVerifier.verifyOnChainProof({
          proof,
          termsDocument,
          observedDocument,
          expectedContractId: this.config.contractId,
          expectedNetwork: this.config.network,
        });

        return {
          statusCode: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
          body: result,
        };
      }

      // 404 Route Not Found
      return this.errorResponse(404, "ROUTE_NOT_FOUND", `Cannot ${method} ${pathname}`, requestId);
    } catch (err: unknown) {
      return this.errorResponse(500, "INTERNAL_SERVER_ERROR", (err as Error).message || "Internal server error", requestId);
    }
  }

  /**
   * Fast in-process test injection method (equivalent to fastify.inject).
   */
  public async inject(options: InjectOptions): Promise<HttpResponse> {
    const req: HttpRequest = {
      method: options.method,
      url: options.url,
      headers: options.headers ?? {},
      body: options.body,
      requestId: options.headers?.["x-request-id"] || generateUuid(),
    };
    return this.handleRequest(req);
  }

  private errorResponse(
    statusCode: number,
    code: string,
    message: string,
    requestId: string,
    details?: unknown
  ): HttpResponse {
    return {
      statusCode,
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: formatApiError(code, message, requestId, details),
    };
  }
}

export function createApiServer(
  config: ApiConfigInput | ApiConfig,
  dbClient: IDatabaseClient,
  anchorService?: OnChainAnchorService,
  chainVerifier?: SorobanChainVerifier
): ApiServer {
  return new ApiServer(config, dbClient, anchorService, chainVerifier);
}
