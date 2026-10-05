import type { IDatabaseClient } from "@stellarclear/db";
import {
  CaseRepository,
  ObservationRepository,
  ReconciliationRepository,
  BreakRepository,
  AttestationRepository,
  DisputeRepository,
  ResolutionRepository,
  ContractEventRepository,
  DisputeExpirationRepository,
} from "@stellarclear/db";
import type { DecodedContractEvent } from "./types.js";
import type { AttestationRole, BreakCode, CaseStatus } from "@stellarclear/schemas";
import type { DbSettlementCase } from "@stellarclear/db";

export interface SyncStats {
  eventsProcessed: number;
  casesUpdated: number;
  lastLedgerSequence: number;
}

export class SettlementStateSynchronizer {
  private caseRepo: CaseRepository;
  private obsRepo: ObservationRepository;
  private recRepo: ReconciliationRepository;
  private breakRepo: BreakRepository;
  private attestationRepo: AttestationRepository;
  private disputeRepo: DisputeRepository;
  private resolutionRepo: ResolutionRepository;
  private disputeExpirationRepo: DisputeExpirationRepository;
  private eventRepo: ContractEventRepository;

  constructor(
    private readonly client: IDatabaseClient,
    private readonly network: string
  ) {
    this.caseRepo = new CaseRepository(client);
    this.obsRepo = new ObservationRepository(client);
    this.recRepo = new ReconciliationRepository(client);
    this.breakRepo = new BreakRepository(client);
    this.attestationRepo = new AttestationRepository(client);
    this.disputeRepo = new DisputeRepository(client);
    this.resolutionRepo = new ResolutionRepository(client);
    this.disputeExpirationRepo = new DisputeExpirationRepository(client);
    this.eventRepo = new ContractEventRepository(client);
  }

  /**
   * Evaluates whether current case status should advance to target status.
   * Prevents replayed or out-of-order older events from regressing state.
   */
  private shouldAdvanceStatus(currentStatus: CaseStatus, targetStatus: CaseStatus): boolean {
    const STATUS_PRECEDENCE: Record<CaseStatus, number> = {
      OPEN: 1,
      OBSERVED: 2,
      MATCHED: 3,
      BREAK: 3,
      DISPUTED: 4,
      RESOLVED: 5,
      FINALIZED: 6,
    };
    return (STATUS_PRECEDENCE[targetStatus] ?? 0) >= (STATUS_PRECEDENCE[currentStatus] ?? 0);
  }

  /**
   * Ensures a settlement_case record exists in the database.
   * If not present, creates an initial record from event details.
   */
  private async ensureCase(
    caseId: string,
    event: DecodedContractEvent,
    initialStatus: CaseStatus,
    extraFields: Partial<DbSettlementCase> = {}
  ): Promise<DbSettlementCase> {
    const existing = await this.caseRepo.findById(caseId, this.network);
    if (existing) {
      return existing;
    }
    const owner = String(event.payload["owner"] || "");
    const counterparty = event.payload["counterparty"] ? String(event.payload["counterparty"]) : null;
    const expiresAtLedger = Number(event.payload["expiresAtLedger"] || 0);
    const now = new Date();
    const newCase: DbSettlementCase = {
      id: caseId,
      network: this.network,
      contract_id: event.contractId,
      owner,
      counterparty,
      trade_reference: String(event.payload["tradeReference"] || `CHAIN-${caseId.slice(0, 8)}`),
      asset: String(event.payload["asset"] || "UNKNOWN"),
      amount: String(event.payload["amount"] || "0"),
      expected_destination: String(event.payload["expectedDestination"] || owner),
      reference: event.payload["reference"] ? String(event.payload["reference"]) : null,
      terms_commitment: String(event.payload["termsCommitment"] || caseId),
      expires_at_ledger: expiresAtLedger,
      status: initialStatus,
      submission_status: "CONFIRMED",
      confirmed_at_ledger: event.ledger,
      created_at: now,
      updated_at: now,
      ...extraFields,
    };
    return await this.caseRepo.insert(newCase);
  }

  /**
   * Synchronizes settlement state from a decoded Soroban contract event.
   * Performs idempotent state updates preserving existing proof references and preventing state regression.
   */
  public async syncEvent(event: DecodedContractEvent): Promise<boolean> {
    // 1. Ingest into contract_events table (idempotent ON CONFLICT)
    await this.eventRepo.insert({
      network: this.network,
      contract_id: event.contractId,
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_type: event.type,
      case_id: event.caseId,
      topic_xdr: event.topicXdr,
      data_xdr: event.dataXdr,
      cursor: event.cursor,
    });

    if (event.type === "ObserverAdded" || event.type === "ObserverRemoved") {
      return true;
    }

    if (!event.caseId) {
      return false;
    }

    const caseId = event.caseId;

    switch (event.type) {
      case "CaseCreated": {
        const existing = await this.caseRepo.findById(caseId, this.network);
        if (existing) {
          const owner = event.payload["owner"] ? String(event.payload["owner"]) : existing.owner;
          const counterparty = event.payload["counterparty"] ? String(event.payload["counterparty"]) : existing.counterparty;
          const expiresAtLedger = event.payload["expiresAtLedger"] ? Number(event.payload["expiresAtLedger"]) : existing.expires_at_ledger;
          const tradeReference = event.payload["tradeReference"] ? String(event.payload["tradeReference"]) : existing.trade_reference;
          const asset = event.payload["asset"] ? String(event.payload["asset"]) : existing.asset;
          const amount = event.payload["amount"] ? String(event.payload["amount"]) : existing.amount;
          const expectedDestination = event.payload["expectedDestination"] ? String(event.payload["expectedDestination"]) : existing.expected_destination;
          const termsCommitment = event.payload["termsCommitment"] ? String(event.payload["termsCommitment"]) : existing.terms_commitment;
          const reference = event.payload["reference"] ? String(event.payload["reference"]) : existing.reference;

          await this.caseRepo.updateChainReferences(caseId, this.network, {
            create_tx_hash: event.txHash,
            created_at_ledger: event.ledger,
            submission_status: "CONFIRMED",
            confirmed_at_ledger: event.ledger,
            owner,
            counterparty,
            expires_at_ledger: expiresAtLedger,
            trade_reference: tradeReference,
            asset,
            amount,
            expected_destination: expectedDestination,
            terms_commitment: termsCommitment,
            reference,
          });
        } else {
          const owner = String(event.payload["owner"] || "");
          const counterparty = event.payload["counterparty"] ? String(event.payload["counterparty"]) : null;
          const expiresAtLedger = Number(event.payload["expiresAtLedger"] || 0);
          const now = new Date();
          await this.caseRepo.insert({
            id: caseId,
            network: this.network,
            contract_id: event.contractId,
            owner,
            counterparty,
            trade_reference: String(event.payload["tradeReference"] || `CHAIN-${caseId.slice(0, 8)}`),
            asset: String(event.payload["asset"] || "UNKNOWN"),
            amount: String(event.payload["amount"] || "0"),
            expected_destination: String(event.payload["expectedDestination"] || owner),
            reference: event.payload["reference"] ? String(event.payload["reference"]) : null,
            terms_commitment: String(event.payload["termsCommitment"] || caseId),
            expires_at_ledger: expiresAtLedger,
            status: "OPEN",
            create_tx_hash: event.txHash,
            created_at_ledger: event.ledger,
            submission_status: "CONFIRMED",
            confirmed_at_ledger: event.ledger,
            created_at: now,
            updated_at: now,
          });
        }
        return true;
      }

      case "ObservationRecorded": {
        const caseRecord = await this.ensureCase(caseId, event, "OBSERVED", {
          observation_tx_hash: event.txHash,
          confirmed_at_ledger: event.ledger,
        });
        if (this.shouldAdvanceStatus(caseRecord.status, "OBSERVED")) {
          await this.caseRepo.updateStatus(caseId, this.network, "OBSERVED");
        }
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          observation_tx_hash: event.txHash,
          confirmed_at_ledger: event.ledger,
        });

        const existingObs = await this.obsRepo.findByCaseId(caseId, this.network);
        if (existingObs) {
          await this.obsRepo.updateChainReferences(caseId, this.network, {
            observation_tx_hash: event.txHash,
            confirmed_at_ledger: event.ledger,
          });
        } else {
          const observer = String(event.payload["observer"] || "");
          const txHash = String(event.payload["txHash"] || event.txHash);
          const observedLedger = Number(event.payload["observedLedger"] || event.ledger);
          const obsCommitment = String(event.payload["observationCommitment"] || event.txHash);
          await this.obsRepo.insert({
            network: this.network,
            case_id: caseId,
            observer,
            tx_hash: txHash,
            observed_ledger: observedLedger,
            observation_commitment: obsCommitment,
            observation_tx_hash: event.txHash,
            confirmed_at_ledger: event.ledger,
            asset: String(event.payload["asset"] || "UNKNOWN"),
            amount: String(event.payload["amount"] || "0"),
            destination: String(event.payload["destination"] || observer),
            status: "SUCCESS",
            observed_at: new Date(),
          });
        }
        return true;
      }

      case "CaseMatched": {
        const caseRecord = await this.ensureCase(caseId, event, "MATCHED", {
          reconciliation_tx_hash: event.txHash,
          confirmed_at_ledger: event.ledger,
        });
        if (this.shouldAdvanceStatus(caseRecord.status, "MATCHED")) {
          await this.caseRepo.updateStatus(caseId, this.network, "MATCHED");
        }
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          reconciliation_tx_hash: event.txHash,
          confirmed_at_ledger: event.ledger,
        });

        const existingRec = await this.recRepo.findByCaseId(caseId, this.network);
        if (existingRec) {
          await this.recRepo.updateChainReferences(caseId, this.network, {
            reconciliation_tx_hash: event.txHash,
            confirmed_at_ledger: event.ledger,
          });
        } else {
          await this.recRepo.insert({
            network: this.network,
            case_id: caseId,
            status: "MATCHED",
            matched: true,
            reconciliation_tx_hash: event.txHash,
            confirmed_at_ledger: event.ledger,
            reconciled_at: new Date(),
          });
        }
        return true;
      }

      case "CaseBroken": {
        const breakCode = (event.payload["breakCode"] as BreakCode) || "AMOUNT_MISMATCH";
        const caseRecord = await this.ensureCase(caseId, event, "BREAK", {
          reconciliation_tx_hash: event.txHash,
          confirmed_at_ledger: event.ledger,
        });
        if (this.shouldAdvanceStatus(caseRecord.status, "BREAK")) {
          await this.caseRepo.updateStatus(caseId, this.network, "BREAK");
        }
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          reconciliation_tx_hash: event.txHash,
          confirmed_at_ledger: event.ledger,
        });

        const existingRec = await this.recRepo.findByCaseId(caseId, this.network);
        if (existingRec) {
          await this.recRepo.updateChainReferences(caseId, this.network, {
            reconciliation_tx_hash: event.txHash,
            confirmed_at_ledger: event.ledger,
          });
        } else {
          const recResult = await this.recRepo.insert({
            network: this.network,
            case_id: caseId,
            status: "BREAK",
            matched: false,
            reconciliation_tx_hash: event.txHash,
            confirmed_at_ledger: event.ledger,
            reconciled_at: new Date(),
          });
          const existingBreaks = await this.breakRepo.findByCaseId(caseId, this.network);
          if (existingBreaks.length === 0) {
            await this.breakRepo.insertMany([
              {
                network: this.network,
                case_id: caseId,
                reconciliation_id: recResult.id,
                code: breakCode,
                field: "amount",
                message: `On-chain break recorded: ${breakCode}`,
              },
            ]);
          }
        }
        return true;
      }

      case "AttestationSubmitted": {
        const attestor = String(event.payload["attestor"]);
        const role = event.payload["role"] as AttestationRole;
        await this.attestationRepo.insert({
          network: this.network,
          case_id: caseId,
          role,
          attestor,
          commitment: event.txHash,
          attested_at_ledger: event.ledger,
        });
        await this.ensureCase(caseId, event, "OPEN", {
          attestation_tx_hash: event.txHash,
        });
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          attestation_tx_hash: event.txHash,
        });
        return true;
      }

      case "DisputeOpened": {
        const initiator = String(event.payload["initiator"] || "");
        const disputeCommitment = String(event.payload["disputeCommitment"] || "");
        await this.disputeRepo.insert({
          network: this.network,
          case_id: caseId,
          initiator,
          dispute_commitment: disputeCommitment,
          opened_at_ledger: event.ledger,
        });
        const caseRecord = await this.ensureCase(caseId, event, "DISPUTED", {
          dispute_tx_hash: event.txHash,
        });
        if (this.shouldAdvanceStatus(caseRecord.status, "DISPUTED")) {
          await this.caseRepo.updateStatus(caseId, this.network, "DISPUTED");
        }
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          dispute_tx_hash: event.txHash,
        });
        return true;
      }

      case "ResolutionSubmitted": {
        const resolver = String(event.payload["resolver"] || "");
        const resolutionCommitment = String(event.payload["resolutionCommitment"] || "");
        await this.resolutionRepo.insert({
          network: this.network,
          case_id: caseId,
          resolver,
          resolution_commitment: resolutionCommitment,
          submitted_at_ledger: event.ledger,
        });
        await this.ensureCase(caseId, event, "DISPUTED", {
          resolution_tx_hash: event.txHash,
        });
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          resolution_tx_hash: event.txHash,
        });
        return true;
      }

      case "DisputeResolved": {
        const caseRecord = await this.ensureCase(caseId, event, "RESOLVED", {
          resolution_tx_hash: event.txHash,
        });
        if (this.shouldAdvanceStatus(caseRecord.status, "RESOLVED")) {
          await this.caseRepo.updateStatus(caseId, this.network, "RESOLVED");
        }
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          resolution_tx_hash: event.txHash,
        });
        return true;
      }

      case "CaseFinalized": {
        const finalizedLedger = Number(event.payload["finalizedAtLedger"] || event.ledger);
        const caseRecord = await this.ensureCase(caseId, event, "FINALIZED", {
          finalization_tx_hash: event.txHash,
          finalized_at_ledger: finalizedLedger,
        });
        if (this.shouldAdvanceStatus(caseRecord.status, "FINALIZED")) {
          await this.caseRepo.updateStatus(caseId, this.network, "FINALIZED", finalizedLedger);
        }
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          finalization_tx_hash: event.txHash,
          finalized_at_ledger: finalizedLedger,
        });
        return true;
      }

      case "DisputeExpired": {
        const closedAtLedger = Number(event.payload["closedAtLedger"] || event.ledger);
        const caseRecord = await this.ensureCase(caseId, event, "BREAK", {
          dispute_tx_hash: event.txHash,
        });
        await this.disputeExpirationRepo.insert({
          network: this.network,
          case_id: caseId,
          expired_at_ledger: closedAtLedger,
          event_cursor: event.cursor,
          tx_hash: event.txHash,
        });
        // Only a DISPUTED case may return to BREAK; never regress RESOLVED/FINALIZED on replay.
        if (caseRecord.status === "DISPUTED") {
          await this.caseRepo.updateStatus(caseId, this.network, "BREAK");
        }
        await this.caseRepo.updateDisputeExpiration(caseId, this.network, null);
        await this.caseRepo.updateChainReferences(caseId, this.network, {
          confirmed_at_ledger: event.ledger,
        });
        console.log(
          JSON.stringify({
            level: "info",
            component: "indexer",
            event: "DisputeExpired",
            network: this.network,
            caseId,
            expirationLedger: Number(event.payload["expirationLedger"] || 0),
            closedAtLedger,
            txHash: event.txHash,
            cursor: event.cursor,
          })
        );
        return true;
      }

      case "CaseQuorumSet": {
        const quorum = Number(event.payload["quorum"] || 1);
        await this.ensureCase(caseId, event, "OPEN", { observer_quorum: quorum });
        await this.caseRepo.updateQuorum(caseId, this.network, quorum);
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Synchronizes a batch of decoded contract events.
   */
  public async syncBatch(events: DecodedContractEvent[]): Promise<SyncStats> {
    let processed = 0;
    let updated = 0;
    let lastLedger = 0;

    for (const ev of events) {
      const changed = await this.syncEvent(ev);
      processed++;
      if (changed) updated++;
      if (ev.ledger > lastLedger) {
        lastLedger = ev.ledger;
      }
    }

    return {
      eventsProcessed: processed,
      casesUpdated: updated,
      lastLedgerSequence: lastLedger,
    };
  }
}
