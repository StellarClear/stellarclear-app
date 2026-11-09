import { Buffer } from "buffer";

/**
 * Attestation record submitted by an observer over a settlement case.
 */
export interface ObserverAttestation {
  caseId: string;
  observer: string;
  commitment: string | Buffer;
  signature?: string | Buffer;
  role?: string;
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * Finalization arguments payload constructed from aggregated observer attestations.
 */
export interface FinalizeCaseArgs {
  caseId: string;
  caseIdBuffer: Buffer;
  observers: string[];
  attestations: ObserverAttestation[];
  commitments: Buffer[];
  signatures: Buffer[];
}

/**
 * Configuration options for ObserverSignatureAggregator.
 */
export interface ObserverSignatureAggregatorOptions {
  caseId?: string;
  whitelist?: string[];
}

/**
 * Aggregates, deduplicates, validates, and batches observer attestations
 * to prepare deterministic finalization payloads for settlement cases.
 *
 * Guarantees:
 * 1. Rejects duplicate signatures and duplicate observer public keys.
 * 2. Ignores unwhitelisted observers.
 * 3. Guarantees deterministic ordering (observers sorted ascending by public key).
 */
export class ObserverSignatureAggregator {
  private targetCaseId?: string;
  private readonly whitelist?: Set<string>;
  private readonly attestations = new Map<string, ObserverAttestation>();
  private readonly recordedSignatures = new Set<string>();

  constructor(options?: ObserverSignatureAggregatorOptions) {
    if (options?.caseId) {
      this.targetCaseId = options.caseId.toLowerCase();
    }
    if (options?.whitelist) {
      this.whitelist = new Set(options.whitelist.map((addr) => addr.trim()));
    }
  }

  /**
   * Adds an observer attestation to the aggregation batch.
   *
   * Validations:
   * - Must contain valid caseId, observer address, and commitment.
   * - CaseId must match the aggregator's target caseId (if set or previously added).
   * - Ignores observers not in the configured whitelist (if whitelist is active).
   * - Rejects duplicate attestations from the same observer public key.
   * - Rejects duplicate signatures.
   *
   * @param attestation The observer attestation to add.
   * @returns true if the attestation was accepted; false if rejected or ignored.
   */
  public addAttestation(attestation: ObserverAttestation): boolean {
    if (!attestation || typeof attestation !== "object") {
      return false;
    }

    const rawCaseId = attestation.caseId;
    if (!rawCaseId || typeof rawCaseId !== "string" || !rawCaseId.trim()) {
      return false;
    }
    const normalizedCaseId = rawCaseId.trim().toLowerCase();

    if (this.targetCaseId && normalizedCaseId !== this.targetCaseId) {
      return false;
    }

    const observerKey = (attestation.observer || (attestation as any).attestor)?.trim();
    if (!observerKey || typeof observerKey !== "string") {
      return false;
    }

    if (!attestation.commitment) {
      return false;
    }

    // Check whitelist if configured
    if (this.whitelist && !this.whitelist.has(observerKey)) {
      return false;
    }

    // Reject duplicate observer public key
    if (this.attestations.has(observerKey)) {
      return false;
    }

    // Reject duplicate signature
    if (attestation.signature !== undefined && attestation.signature !== null) {
      const sigKey = Buffer.isBuffer(attestation.signature)
        ? attestation.signature.toString("hex")
        : String(attestation.signature).trim();

      if (sigKey.length > 0) {
        if (this.recordedSignatures.has(sigKey)) {
          return false;
        }
        this.recordedSignatures.add(sigKey);
      }
    }

    if (!this.targetCaseId) {
      this.targetCaseId = normalizedCaseId;
    }

    this.attestations.set(observerKey, {
      ...attestation,
      caseId: normalizedCaseId,
      observer: observerKey,
    });

    return true;
  }

  /**
   * Validates whether distinct whitelisted observers satisfy the required quorum threshold.
   *
   * @param threshold The minimum required number of distinct observer attestations (must be > 0).
   * @param activeWhitelist The current authorized whitelist of observer addresses.
   * @returns true if distinct whitelisted observers >= threshold; otherwise false.
   */
  public validateQuorum(threshold: number, activeWhitelist: string[]): boolean {
    if (typeof threshold !== "number" || threshold <= 0 || !Array.isArray(activeWhitelist)) {
      return false;
    }

    const allowedObservers = new Set(activeWhitelist.map((w) => w.trim()));
    let validWhitelistedCount = 0;

    for (const observer of this.attestations.keys()) {
      if (allowedObservers.has(observer)) {
        validWhitelistedCount++;
      }
    }

    return validWhitelistedCount >= threshold;
  }

  /**
   * Constructs the deterministic finalization payload for on-chain settlement execution.
   *
   * Observers and attestations are sorted in ascending lexicographical order by observer address
   * to guarantee deterministic hashing and contract payload verification.
   *
   * @returns FinalizeCaseArgs containing sorted observers, commitments, and signatures.
   */
  public toFinalizationPayload(): FinalizeCaseArgs {
    if (this.attestations.size === 0) {
      throw new Error("Cannot produce finalization payload: no attestations have been aggregated");
    }

    const caseId = this.targetCaseId || Array.from(this.attestations.values())[0].caseId;
    const cleanHex = caseId.replace(/^0x/, "");
    const caseIdBuffer = /^[0-9a-fA-F]{64}$/.test(cleanHex)
      ? Buffer.from(cleanHex, "hex")
      : Buffer.from(caseId, "utf-8");

    // Deterministic ordering: sorted by observer public key ascending
    const sortedObservers = Array.from(this.attestations.keys()).sort((a, b) => a.localeCompare(b));
    const sortedAttestations = sortedObservers.map((obs) => this.attestations.get(obs)!);

    const commitments = sortedAttestations.map((a) => {
      if (Buffer.isBuffer(a.commitment)) {
        return a.commitment;
      }
      const rawHex = String(a.commitment).replace(/^0x/, "");
      return /^[0-9a-fA-F]+$/.test(rawHex) && rawHex.length % 2 === 0
        ? Buffer.from(rawHex, "hex")
        : Buffer.from(String(a.commitment), "utf-8");
    });

    const signatures = sortedAttestations.map((a) => {
      if (!a.signature) {
        return Buffer.alloc(0);
      }
      if (Buffer.isBuffer(a.signature)) {
        return a.signature;
      }
      const rawHex = String(a.signature).replace(/^0x/, "");
      return /^[0-9a-fA-F]+$/.test(rawHex) && rawHex.length % 2 === 0
        ? Buffer.from(rawHex, "hex")
        : Buffer.from(String(a.signature), "utf-8");
    });

    return {
      caseId,
      caseIdBuffer,
      observers: sortedObservers,
      attestations: sortedAttestations,
      commitments,
      signatures,
    };
  }

  /**
   * Returns all currently aggregated attestations in deterministic sorted order.
   */
  public getAttestations(): ObserverAttestation[] {
    const sortedObservers = Array.from(this.attestations.keys()).sort((a, b) => a.localeCompare(b));
    return sortedObservers.map((obs) => ({ ...this.attestations.get(obs)! }));
  }

  /**
   * Returns distinct observer public keys in deterministic sorted order.
   */
  public getDistinctObservers(): string[] {
    return Array.from(this.attestations.keys()).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Retrieves an attestation for a specific observer address if present.
   */
  public getAttestation(observer: string): ObserverAttestation | undefined {
    const record = this.attestations.get(observer.trim());
    return record ? { ...record } : undefined;
  }

  /**
   * Checks whether an observer has already submitted an attestation.
   */
  public hasObserver(observer: string): boolean {
    return this.attestations.has(observer.trim());
  }

  /**
   * Returns the count of distinct accepted attestations.
   */
  public getCount(): number {
    return this.attestations.size;
  }

  /**
   * Returns the target case ID for this aggregator.
   */
  public getCaseId(): string | undefined {
    return this.targetCaseId;
  }

  /**
   * Resets all aggregated attestations and recorded signatures.
   */
  public clear(): void {
    this.attestations.clear();
    this.recordedSignatures.clear();
  }
}
