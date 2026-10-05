import { Buffer } from "buffer";
import {
  Client as RegistryClient,
  contract,
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
  computeTermsCommitmentBuffer,
  computeObservationCommitmentBuffer,
  computeDeterministicCaseId,
} from "@stellarclear/proof";
import {
  breakCodeToContract,
  attestationRoleToContract,
  decodeCaseRecord,
  decodeAttestationRecord,
} from "./helpers.js";
import { normalizeContractError, MissingTransactionHashError } from "./errors.js";
import type { CaseRecord, AttestationRecord, TransactionResult, QuorumVerificationResult } from "./types.js";
import type { StellarClearConfig } from "./config.js";

/**
 * Extracts a real transaction hash from a Soroban AssembledTransaction response.
 *
 * NEVER fabricates an identifier. If a real hash cannot be obtained the
 * function throws a typed MissingTransactionHashError so the caller gets an
 * explicit failure rather than silently accepting a fake hash as settlement evidence.
 *
 * @param tx - The value returned by the contract client (AssembledTransaction or similar)
 * @returns The hex transaction hash string
 * @throws {MissingTransactionHashError} If no real hash is present in the response
 */
export function extractTxHash(tx: unknown): string {
  if (typeof tx === "object" && tx !== null) {
    const rec = tx as Record<string, unknown>;
    if (typeof rec["txHash"] === "string" && rec["txHash"].length > 0) {
      return rec["txHash"];
    }
    if (typeof rec["hash"] === "string" && rec["hash"].length > 0) {
      return rec["hash"];
    }
    const raw = rec["raw"] as { hash?: () => { toString: (fmt: string) => string } } | undefined;
    if (typeof raw?.hash === "function") {
      try {
        const h = raw.hash().toString("hex");
        if (h && h.length > 0) return h;
      } catch {
        // fall through to error
      }
    }
  }
  throw new MissingTransactionHashError(
    "SDK_MISSING_TX_HASH: Soroban transaction response did not include a real transaction hash. " +
    "The operation cannot be recorded as settlement evidence without a verifiable on-chain identifier."
  );
}

/**
 * Extracts a transaction hash in SIMULATION / TEST mode only.
 *
 * This path is explicitly marked as simulation-only and must never be called
 * from production code paths. Returns a deterministic stub prefixed with
 * "sim_" so it can never be mistaken for a real Stellar transaction hash.
 *
 * @param label - A stable label for the simulated operation (not a timestamp)
 * @internal - test/simulation use only
 */
export function extractSimulatedTxHash(label: string): string {
  return `sim_${label}`;
}

export interface SettlementRegistryOperationsOptions {
  client: RegistryClient;
  config: StellarClearConfig;
}

/**
 * High-level SettlementRegistry client operations wrapper directly connecting
 * the TypeScript SDK to Soroban SettlementRegistry bindings.
 */
export class SettlementRegistryOperations {
  private contractClient: RegistryClient;
  private config: StellarClearConfig;

  constructor(options: SettlementRegistryOperationsOptions) {
    this.contractClient = options.client;
    this.config = options.config;
  }

  /**
   * Generates a deterministic case ID from input parameters.
   */
  public generateCaseId(
    owner: string,
    tradeReference: string,
    asset: string,
    deadline: number
  ): string {
    return computeDeterministicCaseId(owner, tradeReference, asset, deadline);
  }

  /**
   * Constructs and executes create_case on Soroban SettlementRegistry contract.
   */
  public async createCase(
    terms: ExpectedSettlement,
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const validated = ExpectedSettlementSchema.parse(terms);
      const termsCommitmentBuffer = computeTermsCommitmentBuffer(validated);
      const caseIdBuffer = Buffer.from(validated.caseId, "hex");

      const tx = await this.contractClient.create_case(
        {
          case_id: caseIdBuffer,
          owner: validated.owner,
          counterparty: validated.counterparty,
          terms_commitment: termsCommitmentBuffer,
          expires_at_ledger: validated.deadline,
        },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Constructs and executes record_observation on Soroban SettlementRegistry contract.
   */
  public async recordObservation(
    params: {
      observer: string;
      caseId: string;
      observation: ObservedSettlement;
    },
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const validated = ObservedSettlementSchema.parse(params.observation);
      const obsCommitmentBuffer = computeObservationCommitmentBuffer(validated);
      const caseIdBuffer = Buffer.from(params.caseId, "hex");
      const txHashBuffer = Buffer.from(validated.txHash, "hex");

      const tx = await this.contractClient.record_observation(
        {
          observer: params.observer,
          case_id: caseIdBuffer,
          tx_hash: txHashBuffer,
          observed_ledger: validated.ledger,
          observation_commitment: obsCommitmentBuffer,
        },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Constructs and executes record_match on Soroban SettlementRegistry contract.
   */
  public async recordMatch(
    params: { observer: string; caseId: string },
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(params.caseId, "hex");
      const tx = await this.contractClient.record_match(
        {
          observer: params.observer,
          case_id: caseIdBuffer,
        },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Constructs and executes record_break on Soroban SettlementRegistry contract.
   */
  public async recordBreak(
    params: {
      observer: string;
      caseId: string;
      breakCode: BreakCode;
    },
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(params.caseId, "hex");
      const breakCodeTag = breakCodeToContract(params.breakCode);

      const tx = await this.contractClient.record_break(
        {
          observer: params.observer,
          case_id: caseIdBuffer,
          break_code: breakCodeTag,
        },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Constructs and executes submit_attestation on Soroban SettlementRegistry contract.
   */
  public async submitAttestation(
    params: {
      caseId: string;
      role: AttestationRole;
      commitment: string | Buffer;
    },
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(params.caseId, "hex");
      const commitmentBuffer =
        typeof params.commitment === "string"
          ? Buffer.from(params.commitment, "hex")
          : params.commitment;
      const roleTag = attestationRoleToContract(params.role);

      const tx = await this.contractClient.submit_attestation(
        {
          case_id: caseIdBuffer,
          role: roleTag,
          commitment: commitmentBuffer,
        },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Constructs and executes open_dispute on Soroban SettlementRegistry contract.
   */
  public async openDispute(
    params: {
      initiator: string;
      caseId: string;
      disputeCommitment: string | Buffer;
    },
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(params.caseId, "hex");
      const commitmentBuffer =
        typeof params.disputeCommitment === "string"
          ? Buffer.from(params.disputeCommitment, "hex")
          : params.disputeCommitment;

      const tx = await this.contractClient.open_dispute(
        {
          initiator: params.initiator,
          case_id: caseIdBuffer,
          dispute_commitment: commitmentBuffer,
        },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Constructs and executes submit_resolution on Soroban SettlementRegistry contract.
   */
  public async submitResolution(
    params: {
      resolver: string;
      caseId: string;
      resolutionCommitment: string | Buffer;
    },
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(params.caseId, "hex");
      const commitmentBuffer =
        typeof params.resolutionCommitment === "string"
          ? Buffer.from(params.resolutionCommitment, "hex")
          : params.resolutionCommitment;

      const tx = await this.contractClient.submit_resolution(
        {
          resolver: params.resolver,
          case_id: caseIdBuffer,
          resolution_commitment: commitmentBuffer,
        },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Constructs and executes finalize_case on Soroban SettlementRegistry contract.
   */
  public async finalizeCase(
    caseId: string,
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const tx = await this.contractClient.finalize_case(
        { case_id: caseIdBuffer },
        options
      );

      return {
        txHash: extractTxHash(tx),
        status: "SUCCESS",
        result: undefined,
      };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Reads and decodes a settlement case from contract state.
   */
  public async getCase(
    caseId: string,
    options?: contract.MethodOptions
  ): Promise<CaseRecord> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const tx = await this.contractClient.get_case({ case_id: caseIdBuffer }, options);
      const caseData: SettlementCase = tx.result.unwrap();
      return decodeCaseRecord(caseId, caseData);
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Reads an attestation record from contract state.
   */
  public async getAttestation(
    caseId: string,
    attestor: string,
    options?: contract.MethodOptions
  ): Promise<AttestationRecord | null> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const tx = await this.contractClient.get_attestation(
        { case_id: caseIdBuffer, attestor },
        options
      );
      if (!tx.result) {
        return null;
      }
      return decodeAttestationRecord(caseId, attestor, tx.result);
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Checks if an address is an observer.
   */
  public async isObserver(
    observer: string,
    options?: contract.MethodOptions
  ): Promise<boolean> {
    try {
      const tx = await this.contractClient.is_observer({ observer }, options);
      return tx.result;
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Reads resolution commitment for a case and resolver.
   */
  public async getResolution(
    caseId: string,
    resolver: string,
    options?: contract.MethodOptions
  ): Promise<string | null> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const tx = await this.contractClient.get_resolution(
        { case_id: caseIdBuffer, resolver },
        options
      );
      if (!tx.result) {
        return null;
      }
      return Buffer.from(tx.result).toString("hex").toLowerCase();
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Reads the configured observer quorum threshold for a case.
   */
  public async getCaseQuorum(
    caseId: string,
    options?: contract.MethodOptions
  ): Promise<number> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const tx = await this.contractClient.get_case_quorum(
        { case_id: caseIdBuffer },
        options
      );
      return tx.result;
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Owner-authorized: configures the required observer quorum threshold for a case.
   */
  public async setCaseQuorum(
    caseId: string,
    quorum: number,
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const tx = await this.contractClient.set_case_quorum(
        { case_id: caseIdBuffer, quorum },
        options
      );
      const signAndSend = (tx as any).signAndSend;
      if (typeof signAndSend === "function") {
        const sentTx = await signAndSend.call(tx);
        const txHash = extractTxHash(sentTx);
        return { txHash, status: "SUCCESS", result: undefined };
      }
      const txHash = extractTxHash(tx);
      return { txHash, status: "SUCCESS", result: undefined };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Reads the list of distinct observer addresses that submitted attestations for a case.
   */
  public async getAttestedObservers(
    caseId: string,
    options?: contract.MethodOptions
  ): Promise<string[]> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const tx = await this.contractClient.get_attested_observers(
        { case_id: caseIdBuffer },
        options
      );
      return tx.result ?? [];
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
  }

  /**
   * Submits an observer attestation under multi-observer quorum semantics.
   */
  public async submitObserverAttestation(
    caseId: string,
    observer: string,
    commitment: string | Buffer,
    options?: contract.MethodOptions
  ): Promise<TransactionResult<void>> {
    try {
      const caseIdBuffer = Buffer.from(caseId, "hex");
      const commitmentBuffer = Buffer.isBuffer(commitment)
        ? commitment
        : Buffer.from(commitment, "hex");
      const tx = await this.contractClient.submit_observer_attestation(
        { case_id: caseIdBuffer, observer, commitment: commitmentBuffer },
        options
      );
      const signAndSend = (tx as any).signAndSend;
      if (typeof signAndSend === "function") {
        const sentTx = await signAndSend.call(tx);
        const txHash = extractTxHash(sentTx);
        return { txHash, status: "SUCCESS", result: undefined };
      }
      const txHash = extractTxHash(tx);
      return { txHash, status: "SUCCESS", result: undefined };
    } catch (err: unknown) {
      throw normalizeContractError(err);
    }
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
 * Pure evaluation helper for observer quorum verification.
 *
 * Rules:
 * 1. Counts distinct authorized observer attestations (role === "OBSERVER").
 * 2. A duplicate observer counts only once.
 * 3. Owner and counterparty attestations must NOT be counted as observer quorum.
 * 4. Quorum is satisfied if distinctObserverCount >= requiredObserverQuorum.
 */
export function verifyObserverQuorum(params: {
  caseId: string;
  owner: string;
  counterparty?: string | null;
  attestations: Array<{ attestor: string; role: string }>;
  requiredQuorum?: number;
}): QuorumVerificationResult {
  const { caseId, owner, counterparty, attestations } = params;
  const requiredObserverQuorum = params.requiredQuorum ?? 1;

  // Filter for observer role attestations only, strictly excluding owner and counterparty
  const observerAttestations = attestations.filter((a) => {
    const isObserverRole = a.role.toUpperCase() === "OBSERVER";
    const isOwner = a.attestor === owner;
    const isCounterparty = Boolean(counterparty && a.attestor === counterparty);
    return isObserverRole && !isOwner && !isCounterparty;
  });

  const submittedObserverCount = observerAttestations.length;

  // Deduplicate observer addresses
  const distinctSet = new Set<string>();
  for (const a of observerAttestations) {
    distinctSet.add(a.attestor);
  }
  const distinctObservers = Array.from(distinctSet);
  const distinctObserverCount = distinctObservers.length;
  const quorumSatisfied = distinctObserverCount >= requiredObserverQuorum;

  return {
    caseId: caseId.toLowerCase(),
    requiredObserverQuorum,
    submittedObserverCount,
    distinctObserverCount,
    quorumSatisfied,
    distinctObservers,
  };
}
