import { Buffer } from "buffer";
import { InMemoryDatabaseClient, CaseRepository, ObservationRepository, ReconciliationRepository } from "@stellarclear/db";
import { createApiServer, SorobanChainVerifier, type OnChainAnchorService } from "@stellarclear/api";
import {
  computeTermsCommitment,
  computeObservationCommitment,
} from "@stellarclear/proof";
import type {
  ExpectedSettlement,
  ObservedSettlement,
  BreakCode,
  ReconciliationStatus,
  AttestationRole,
} from "@stellarclear/schemas";
import type {
  CaseRecord,
  AttestationRecord,
  TransactionResult,
} from "@stellarclear/sdk";

export const TEST_LIVE_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
export const TEST_LIVE_NETWORK = "testnet";
export const TEST_OBSERVER_ACCOUNT = "GDJEIX4BDUFRKGYP5F74V3Q472K72UAY4OQ7O26U6PZ7VUSZ5JTY4Q4E";

export interface RecordedTx {
  txHash: string;
  type: string;
  caseId: string;
  ledger: number;
  timestamp: string;
  payload?: unknown;
}

/**
 * Stateful live Soroban settlement environment simulator.
 * Simulates authoritative on-chain contract state transitions,
 * cryptographic commitments, attestations, dispute resolution, and ledger progression.
 */
export class LiveSorobanEnvironment implements OnChainAnchorService {
  public currentLedger = 1500000;
  public cases = new Map<string, CaseRecord>();
  public attestations = new Map<string, AttestationRecord>();
  public resolutions = new Map<string, string>();
  public disputes = new Map<string, string>();
  public observers = new Set<string>([TEST_OBSERVER_ACCOUNT]);
  public transactions: RecordedTx[] = [];

  private generateTxHash(prefix: string, id: string): string {
    const raw = `${prefix}_${id}_${this.currentLedger}_${Date.now()}`;
    const hash = Buffer.from(raw).toString("hex").padEnd(64, "0").slice(0, 64);
    return hash;
  }

  public advanceLedger(by: number = 10): number {
    this.currentLedger += by;
    return this.currentLedger;
  }

  public registerObserver(address: string): void {
    this.observers.add(address);
  }

  public revokeObserver(address: string): void {
    this.observers.delete(address);
  }

  public async anchorCaseCreation(
    terms: ExpectedSettlement
  ): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = terms.caseId.toLowerCase();
    const termsCommitment = computeTermsCommitment(terms);
    const txHash = this.generateTxHash("create", caseIdNorm);

    const caseRecord: CaseRecord = {
      caseId: terms.caseId,
      owner: terms.owner,
      counterparty: terms.counterparty,
      termsCommitment,
      expiresAtLedger: terms.deadline,
      status: "OPEN",
      decision: { type: "NONE" },
      createdAtLedger: this.currentLedger,
    };

    this.cases.set(caseIdNorm, caseRecord);
    this.transactions.push({
      txHash,
      type: "CREATE_CASE",
      caseId: terms.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: terms,
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async anchorObservation(params: {
    observer: string;
    caseId: string;
    observation: ObservedSettlement;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }

    const obsCommitment = computeObservationCommitment(params.observation);
    const txHash = this.generateTxHash("obs", params.observation.txHash);

    this.cases.set(caseIdNorm, {
      ...existing,
      observation: {
        txHash: params.observation.txHash,
        observationCommitment: obsCommitment,
        observedLedger: params.observation.ledger,
      },
      status: "OBSERVED",
    });

    this.transactions.push({
      txHash,
      type: "RECORD_OBSERVATION",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: params.observation,
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async anchorReconciliation(params: {
    observer: string;
    caseId: string;
    status: ReconciliationStatus;
    breakCode?: BreakCode;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }

    const txHash = this.generateTxHash("rec", caseIdNorm);

    if (params.status === "MATCHED") {
      this.cases.set(caseIdNorm, {
        ...existing,
        status: "MATCHED",
        decision: { type: "MATCHED" },
      });
    } else {
      this.cases.set(caseIdNorm, {
        ...existing,
        status: "BREAK",
        decision: {
          type: "BREAK",
          breakCode: params.breakCode ?? "AMOUNT_MISMATCH",
        },
      });
    }

    this.transactions.push({
      txHash,
      type: params.status === "MATCHED" ? "RECORD_MATCH" : "RECORD_BREAK",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: { status: params.status, breakCode: params.breakCode },
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async anchorAttestation(params: {
    attestor: string;
    caseId: string;
    role: AttestationRole;
    commitment: string;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }

    if (params.role === "OBSERVER" && !this.observers.has(params.attestor)) {
      throw new Error(`ObserverNotRegistered: ${params.attestor}`);
    }

    const txHash = this.generateTxHash("attest", caseIdNorm);
    const attRecord: AttestationRecord = {
      caseId: params.caseId,
      attestor: params.attestor,
      role: params.role,
      commitment: params.commitment,
      attestedAtLedger: this.currentLedger,
    };

    const key = `${caseIdNorm}:${params.attestor.toLowerCase()}`;
    this.attestations.set(key, attRecord);

    this.transactions.push({
      txHash,
      type: "SUBMIT_ATTESTATION",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: attRecord,
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async setCaseQuorum(caseId: string, quorum: number): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${caseId}`);
    }
    if (quorum <= 0) {
      throw new Error("InvalidObserverQuorum: quorum must be a positive integer");
    }
    this.cases.set(caseIdNorm, {
      ...existing,
      observerQuorum: quorum,
    });
    const txHash = this.generateTxHash("quorum", caseIdNorm);
    this.transactions.push({
      txHash,
      type: "SET_CASE_QUORUM",
      caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: { quorum },
    });
    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async getCaseQuorum(caseId: string): Promise<number> {
    const existing = this.cases.get(caseId.toLowerCase());
    return existing?.observerQuorum ?? 1;
  }

  public async getAttestedObservers(caseId: string): Promise<string[]> {
    const caseIdNorm = caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) return [];
    const distinctObservers = new Set<string>();
    for (const [key, att] of this.attestations.entries()) {
      if (key.startsWith(`${caseIdNorm}:`)) {
        if (
          att.role === "OBSERVER" &&
          att.attestor !== existing.owner &&
          att.attestor !== existing.counterparty &&
          this.observers.has(att.attestor)
        ) {
          distinctObservers.add(att.attestor);
        }
      }
    }
    return Array.from(distinctObservers);
  }

  public async submitObserverAttestation(params: {
    caseId: string;
    observer: string;
    commitment: string;
  }): Promise<TransactionResult<void>> {
    if (!this.observers.has(params.observer)) {
      throw new Error("ObserverNotRegistered: observer address is not registered");
    }
    return this.anchorAttestation({
      caseId: params.caseId,
      attestor: params.observer,
      role: "OBSERVER",
      commitment: params.commitment,
    });
  }

  public async anchorDispute(params: {
    initiator: string;
    caseId: string;
    disputeCommitment: string;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }
    if (existing.status !== "BREAK") {
      throw new Error("InvalidState: disputes can only open from BREAK status");
    }

    const txHash = this.generateTxHash("dispute", caseIdNorm);
    this.disputes.set(caseIdNorm, params.disputeCommitment);
    this.cases.set(caseIdNorm, {
      ...existing,
      status: "DISPUTED",
    });

    this.transactions.push({
      txHash,
      type: "OPEN_DISPUTE",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: params,
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async anchorDisputeWithTtl(params: {
    initiator: string;
    caseId: string;
    disputeCommitment: string;
    ttlLedgers: number;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }
    if (existing.status !== "BREAK") {
      throw new Error("InvalidState: disputes can only open from BREAK status");
    }

    const txHash = this.generateTxHash("dispute_ttl", caseIdNorm);
    this.disputes.set(caseIdNorm, params.disputeCommitment);
    const disputeExpiresAtLedger = this.currentLedger + params.ttlLedgers;
    this.cases.set(caseIdNorm, {
      ...existing,
      status: "DISPUTED",
      disputeExpiresAtLedger,
    });

    this.transactions.push({
      txHash,
      type: "OPEN_DISPUTE",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: { ...params, disputeExpiresAtLedger },
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async anchorExpireDispute(params: {
    caseId: string;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }
    if (existing.status !== "DISPUTED") {
      throw new Error("InvalidState: case is not in DISPUTED state");
    }
    if (
      existing.disputeExpiresAtLedger !== undefined &&
      this.currentLedger < existing.disputeExpiresAtLedger
    ) {
      throw new Error("DisputeNotExpired: dispute has not yet reached its expiration ledger");
    }

    const txHash = this.generateTxHash("expire_dispute", caseIdNorm);
    this.disputes.delete(caseIdNorm);
    this.resolutions.delete(`${caseIdNorm}:${existing.owner.toLowerCase()}`);
    if (existing.counterparty) {
      this.resolutions.delete(`${caseIdNorm}:${existing.counterparty.toLowerCase()}`);
    }

    this.cases.set(caseIdNorm, {
      ...existing,
      status: "BREAK",
      disputeExpiresAtLedger: undefined,
    });

    this.transactions.push({
      txHash,
      type: "EXPIRE_DISPUTE",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: params,
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async anchorResolution(params: {
    resolver: string;
    caseId: string;
    resolutionCommitment: string;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }

    const txHash = this.generateTxHash("resolve", caseIdNorm);
    const key = `${caseIdNorm}:${params.resolver.toLowerCase()}`;
    this.resolutions.set(key, params.resolutionCommitment);

    const ownerRes = this.resolutions.get(`${caseIdNorm}:${existing.owner.toLowerCase()}`);
    const cpRes = existing.counterparty
      ? this.resolutions.get(`${caseIdNorm}:${existing.counterparty.toLowerCase()}`)
      : null;

    if (ownerRes && cpRes && ownerRes.toLowerCase() === cpRes.toLowerCase()) {
      this.cases.set(caseIdNorm, {
        ...existing,
        status: "RESOLVED",
      });
    }

    this.transactions.push({
      txHash,
      type: "SUBMIT_RESOLUTION",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: params,
    });

    return { txHash, status: "SUCCESS", result: undefined };
  }

  public async anchorFinalization(params: {
    caseId: string;
  }): Promise<TransactionResult<void>> {
    this.advanceLedger(1);
    const caseIdNorm = params.caseId.toLowerCase();
    const existing = this.cases.get(caseIdNorm);
    if (!existing) {
      throw new Error(`Case not found on chain: ${params.caseId}`);
    }

    // Verify quorum threshold if quorum > 1
    const requiredQuorum = existing.observerQuorum ?? 1;
    if (requiredQuorum > 1) {
      const distinctObservers = await this.getAttestedObservers(caseIdNorm);
      if (distinctObservers.length < requiredQuorum) {
        throw new Error(
          `ObserverQuorumNotMet: required observer quorum (${requiredQuorum}) not met (found ${distinctObservers.length})`
        );
      }
    }

    const txHash = this.generateTxHash("finalize", caseIdNorm);
    this.cases.set(caseIdNorm, {
      ...existing,
      status: "FINALIZED",
      finalizedAtLedger: this.currentLedger,
    });

    this.transactions.push({
      txHash,
      type: "FINALIZE_CASE",
      caseId: params.caseId,
      ledger: this.currentLedger,
      timestamp: new Date().toISOString(),
      payload: params,
    });

    return { txHash, status: "SUCCESS", result: undefined, ledger: this.currentLedger };
  }

  public async getCase(caseId: string): Promise<CaseRecord | null> {
    return this.getOnChainCase(caseId);
  }

  public async getAttestation(caseId: string, attestor: string): Promise<AttestationRecord | null> {
    return this.getOnChainAttestation(caseId, attestor);
  }

  public async getOnChainCase(caseId: string): Promise<CaseRecord | null> {
    return this.cases.get(caseId.toLowerCase()) ?? null;
  }

  public async getOnChainAttestation(
    caseId: string,
    attestor: string
  ): Promise<AttestationRecord | null> {
    const key = `${caseId.toLowerCase()}:${attestor.toLowerCase()}`;
    return this.attestations.get(key) ?? null;
  }

  public async getOnChainResolution(
    caseId: string,
    resolver: string
  ): Promise<string | null> {
    const key = `${caseId.toLowerCase()}:${resolver.toLowerCase()}`;
    return this.resolutions.get(key) ?? null;
  }
}

export function setupLiveSettlementEnvironment() {
  const db = new InMemoryDatabaseClient();
  const caseRepo = new CaseRepository(db);
  const obsRepo = new ObservationRepository(db);
  const recRepo = new ReconciliationRepository(db);
  const soroban = new LiveSorobanEnvironment();
  const chainVerifier = new SorobanChainVerifier(soroban, TEST_LIVE_CONTRACT_ID, TEST_LIVE_NETWORK);
  const server = createApiServer(
    {
      port: 3000,
      host: "0.0.0.0",
      network: TEST_LIVE_NETWORK,
      databaseUrl: "postgres://localhost:5432/test",
      contractId: TEST_LIVE_CONTRACT_ID,
    },
    db,
    soroban,
    chainVerifier
  );

  return { db, caseRepo, obsRepo, recRepo, soroban, server };
}
