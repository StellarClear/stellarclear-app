import { Buffer } from "buffer";
import {
  Client as RegistryClient,
  contract,
  rpc,
  type SettlementCase,
} from "settlement-registry";
import {
  ExpectedSettlementSchema,
  ObservedSettlementSchema,
  type ExpectedSettlement,
  type ObservedSettlement,
  type BreakCode,
  type AttestationRole,
} from "@stellarclear/schemas";
import {
  computeTermsCommitment,
  computeTermsCommitmentBuffer,
  computeObservationCommitment,
  computeObservationCommitmentBuffer,
  computeDeterministicCaseId,
} from "@stellarclear/proof";
import {
  validateConfig,
  type StellarClearConfig,
  type StellarClearConfigInput,
} from "./config.js";
import { normalizeContractError, type StellarClearError } from "./errors.js";
import {
  breakCodeToContract,
  attestationRoleToContract,
  decodeCaseRecord,
  decodeAttestationRecord,
} from "./helpers.js";
import type { CaseRecord, AttestationRecord, QuorumVerificationResult } from "./types.js";
import { verifyObserverQuorum } from "./settlement-registry.js";

/**
 * Core StellarClear SDK client providing high-level domain operations
 * over the Soroban SettlementRegistry contract.
 */
export class StellarClearClient {
  public readonly config: StellarClearConfig;
  public readonly contractClient: RegistryClient;
  public readonly rpcServer: rpc.Server;

  constructor(configInput: StellarClearConfigInput) {
    this.config = validateConfig(configInput);
    this.contractClient = new RegistryClient({
      contractId: this.config.contractId,
      networkPassphrase: this.config.networkPassphrase,
      rpcUrl: this.config.rpcUrl,
      allowHttp: this.config.allowHttp,
      publicKey: this.config.publicKey,
    });
    this.rpcServer = new rpc.Server(this.config.rpcUrl, {
      allowHttp: this.config.allowHttp,
    });
  }

  public get contractId(): string {
    return this.config.contractId;
  }

  public get network(): string {
    return this.config.network;
  }

  public get networkPassphrase(): string {
    return this.config.networkPassphrase;
  }

  public normalizeError(err: unknown): StellarClearError {
    return normalizeContractError(err);
  }

  /**
   * Helper to generate a deterministic 32-byte caseId from origin parameters.
   */
  public generateCaseId(
    owner: string,
    tradeReference: string,
    asset: string,
    deadline: number
  ): string {
    return computeDeterministicCaseId(owner, tradeReference, asset, deadline);
  }

  // ==========================================
  // CASE WRITES
  // ==========================================

  /**
   * Opens a new settlement case with terms commitment and expiry.
   */
  public async createCase(
    terms: ExpectedSettlement,
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const validated = ExpectedSettlementSchema.parse(terms);
    const termsCommitmentBuffer = computeTermsCommitmentBuffer(validated);
    const caseIdBuffer = Buffer.from(validated.caseId, "hex");

    return this.contractClient.create_case(
      {
        case_id: caseIdBuffer,
        owner: validated.owner,
        counterparty: validated.counterparty,
        terms_commitment: termsCommitmentBuffer,
        expires_at_ledger: validated.deadline,
      },
      options
    );
  }

  /**
   * Records an observed settlement transaction for an open case.
   */
  public async recordObservation(
    params: {
      observer: string;
      caseId: string;
      observation: ObservedSettlement;
    },
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const validated = ObservedSettlementSchema.parse(params.observation);
    const obsCommitmentBuffer = computeObservationCommitmentBuffer(validated);
    const caseIdBuffer = Buffer.from(params.caseId, "hex");
    const txHashBuffer = Buffer.from(validated.txHash, "hex");

    return this.contractClient.record_observation(
      {
        observer: params.observer,
        case_id: caseIdBuffer,
        tx_hash: txHashBuffer,
        observed_ledger: validated.ledger,
        observation_commitment: obsCommitmentBuffer,
      },
      options
    );
  }

  /**
   * Records a matched reconciliation decision.
   */
  public async recordMatch(
    params: { observer: string; caseId: string },
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(params.caseId, "hex");
    return this.contractClient.record_match(
      {
        observer: params.observer,
        case_id: caseIdBuffer,
      },
      options
    );
  }

  /**
   * Records a reconciliation break decision with standardized break code.
   */
  public async recordBreak(
    params: {
      observer: string;
      caseId: string;
      breakCode: BreakCode;
    },
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(params.caseId, "hex");
    const breakCodeTag = breakCodeToContract(params.breakCode);

    return this.contractClient.record_break(
      {
        observer: params.observer,
        case_id: caseIdBuffer,
        break_code: breakCodeTag,
      },
      options
    );
  }

  /**
   * Submits a cryptographic attestation for an active settlement case.
   */
  public async submitAttestation(
    params: {
      caseId: string;
      role: AttestationRole;
      commitment: string | Buffer;
    },
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(params.caseId, "hex");
    const commitmentBuffer =
      typeof params.commitment === "string"
        ? Buffer.from(params.commitment, "hex")
        : params.commitment;
    const roleTag = attestationRoleToContract(params.role);

    return this.contractClient.submit_attestation(
      {
        case_id: caseIdBuffer,
        role: roleTag,
        commitment: commitmentBuffer,
      },
      options
    );
  }

  /**
   * Opens a dispute against a broken settlement case.
   */
  public async openDispute(
    params: {
      initiator: string;
      caseId: string;
      disputeCommitment: string | Buffer;
    },
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(params.caseId, "hex");
    const commitmentBuffer =
      typeof params.disputeCommitment === "string"
        ? Buffer.from(params.disputeCommitment, "hex")
        : params.disputeCommitment;

    return this.contractClient.open_dispute(
      {
        initiator: params.initiator,
        case_id: caseIdBuffer,
        dispute_commitment: commitmentBuffer,
      },
      options
    );
  }

  /**
   * Submits a dispute resolution commitment.
   */
  public async submitResolution(
    params: {
      resolver: string;
      caseId: string;
      resolutionCommitment: string | Buffer;
    },
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(params.caseId, "hex");
    const commitmentBuffer =
      typeof params.resolutionCommitment === "string"
        ? Buffer.from(params.resolutionCommitment, "hex")
        : params.resolutionCommitment;

    return this.contractClient.submit_resolution(
      {
        resolver: params.resolver,
        case_id: caseIdBuffer,
        resolution_commitment: commitmentBuffer,
      },
      options
    );
  }

  /**
   * Finalizes a matched or resolved settlement case.
   */
  public async finalizeCase(
    caseId: string,
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    return this.contractClient.finalize_case({ case_id: caseIdBuffer }, options);
  }

  // ==========================================
  // CASE READS
  // ==========================================

  /**
   * Reads and decodes a settlement case by ID.
   */
  public async getCase(caseId: string, options?: contract.MethodOptions): Promise<CaseRecord> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    const tx = await this.contractClient.get_case({ case_id: caseIdBuffer }, options);
    const caseData: SettlementCase = tx.result.unwrap();
    return decodeCaseRecord(caseId, caseData);
  }

  /**
   * Reads an attestation record by case ID and attestor address.
   */
  public async getAttestation(
    caseId: string,
    attestor: string,
    options?: contract.MethodOptions
  ): Promise<AttestationRecord | null> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    const tx = await this.contractClient.get_attestation(
      {
        case_id: caseIdBuffer,
        attestor,
      },
      options
    );
    if (!tx.result) {
      return null;
    }
    return decodeAttestationRecord(caseId, attestor, tx.result);
  }

  /**
   * Checks whether an address is a registered observer in the registry.
   */
  public async isObserver(observer: string, options?: contract.MethodOptions): Promise<boolean> {
    const tx = await this.contractClient.is_observer({ observer }, options);
    return tx.result;
  }

  /**
   * Reads resolution commitment for a case and resolver.
   */
  public async getResolution(
    caseId: string,
    resolver: string,
    options?: contract.MethodOptions
  ): Promise<string | null> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    const tx = await this.contractClient.get_resolution(
      {
        case_id: caseIdBuffer,
        resolver,
      },
      options
    );
    if (!tx.result) {
      return null;
    }
    return Buffer.from(tx.result).toString("hex").toLowerCase();
  }

  // ==========================================
  // OBSERVER ADMINISTRATION
  // ==========================================

  public async addObserver(
    observer: string,
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    return this.contractClient.add_observer({ observer }, options);
  }

  public async removeObserver(
    observer: string,
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    return this.contractClient.remove_observer({ observer }, options);
  }

  /**
   * Reads latest ledger sequence from the Stellar RPC server.
   */
  public async getLatestLedger(): Promise<number> {
    const res = await this.rpcServer.getLatestLedger();
    return res.sequence;
  }

  // ==========================================
  // OBSERVER QUORUM
  // ==========================================

  /**
   * Reads the configured observer quorum threshold for a case.
   */
  public async getCaseQuorum(
    caseId: string,
    options?: contract.MethodOptions
  ): Promise<number> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    const tx = await this.contractClient.get_case_quorum({ case_id: caseIdBuffer }, options);
    return tx.result;
  }

  /**
   * Configures the required observer quorum threshold for a case.
   */
  public async setCaseQuorum(
    caseId: string,
    quorum: number,
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    return this.contractClient.set_case_quorum({ case_id: caseIdBuffer, quorum }, options);
  }

  /**
   * Reads the list of distinct observer addresses that submitted attestations for a case.
   */
  public async getAttestedObservers(
    caseId: string,
    options?: contract.MethodOptions
  ): Promise<string[]> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    const tx = await this.contractClient.get_attested_observers({ case_id: caseIdBuffer }, options);
    return tx.result ?? [];
  }

  /**
   * Submits an observer attestation under multi-observer quorum semantics.
   */
  public async submitObserverAttestation(
    caseId: string,
    observer: string,
    commitment: string | Buffer,
    options?: contract.MethodOptions
  ): Promise<contract.AssembledTransaction<contract.Result<void, contract.ErrorMessage>>> {
    const caseIdBuffer = Buffer.from(caseId, "hex");
    const commitmentBuffer = Buffer.isBuffer(commitment)
      ? commitment
      : Buffer.from(commitment, "hex");
    return this.contractClient.submit_observer_attestation(
      { case_id: caseIdBuffer, observer, commitment: commitmentBuffer },
      options
    );
  }

  /**
   * Evaluates whether the required observer quorum is satisfied for a case.
   */
  public async verifyCaseQuorum(
    caseId: string,
    attestations: Array<{ attestor: string; role: string }>,
    requiredQuorumOverride?: number,
    options?: contract.MethodOptions
  ): Promise<QuorumVerificationResult> {
    const caseRecord = await this.getCase(caseId, options);
    if (!caseRecord) {
      throw new Error(`Case ${caseId} not found on contract`);
    }
    const requiredQuorum = requiredQuorumOverride ?? caseRecord.observerQuorum ?? 1;
    return verifyObserverQuorum({
      caseId,
      owner: caseRecord.owner,
      counterparty: caseRecord.counterparty,
      attestations,
      requiredQuorum,
    });
  }
}

/**
 * Alias for StellarClearClient providing SettlementRegistry operations.
 */
export class SettlementRegistryClient extends StellarClearClient {}

