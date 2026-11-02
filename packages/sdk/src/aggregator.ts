import { Buffer } from "buffer";

/**
 * Representation of an observer attestation submitted for settlement verification.
 */
export interface ObserverAttestation {
  caseId: string;
  observer: string;
  commitment: string;
  signature?: string;
  ledger?: number;
}

/**
 * Encapsulated finalization payload with deterministically sorted observer attestations.
 */
export interface FinalizeCaseArgs {
  caseId: string;
  case_id: Buffer;
  attestations: ObserverAttestation[];
  observers: string[];
  count: number;
}

export interface AggregatorOptions {
  whitelist?: string[];
}

/**
 * ObserverSignatureAggregator manages collection, deduplication, whitelist filtering,
 * quorum verification, and deterministic ordering of observer signatures/attestations
 * prior to on-chain case finalization.
 */
export class ObserverSignatureAggregator {
  private readonly caseId: string;
  private readonly attestations = new Map<string, ObserverAttestation>();
  private whitelist?: Set<string>;

  constructor(caseId: string, options?: AggregatorOptions) {
    if (!caseId || typeof caseId !== "string" || caseId.trim().length === 0) {
      throw new Error("ObserverSignatureAggregator requires a valid non-empty caseId");
    }
    this.caseId = caseId.trim().toLowerCase();
    if (options?.whitelist) {
      this.whitelist = new Set(options.whitelist.map((w) => w.trim()));
    }
  }

  /**
   * Returns the case ID associated with this aggregator instance.
   */
  public getCaseId(): string {
    return this.caseId;
  }

  /**
   * Sets or updates the active observer whitelist.
   */
  public setWhitelist(whitelist: string[]): void {
    this.whitelist = new Set(whitelist.map((w) => w.trim()));
  }

  /**
   * Adds an observer attestation.
   *
   * Rejection criteria (returns false):
   * - Invalid / missing fields
   * - Case ID mismatch
   * - Duplicate submission from the same observer address
   * - Observer not present in configured active whitelist
   *
   * @param attestation The observer attestation to ingest
   * @returns true if added, false if rejected or duplicate
   */
  public addAttestation(attestation: ObserverAttestation): boolean {
    if (!attestation || !attestation.caseId || !attestation.observer || !attestation.commitment) {
      return false;
    }

    const normalizedCaseId = attestation.caseId.trim().toLowerCase();
    if (normalizedCaseId !== this.caseId) {
      return false;
    }

    const observerKey = attestation.observer.trim();
    if (observerKey.length === 0) {
      return false;
    }

    // Reject duplicate observer submissions
    if (this.attestations.has(observerKey)) {
      return false;
    }

    // Ignore unwhitelisted observers if whitelist is configured
    if (this.whitelist && !this.whitelist.has(observerKey)) {
      return false;
    }

    this.attestations.set(observerKey, {
      ...attestation,
      caseId: this.caseId,
      observer: observerKey,
      commitment: attestation.commitment.trim().toLowerCase(),
    });

    return true;
  }

  /**
   * Validates whether current valid observer attestations satisfy the required quorum threshold.
   *
   * @param threshold Minimum number of distinct whitelisted observers required (must be > 0)
   * @param activeWhitelist Optional runtime whitelist of authorized observers
   * @returns true if distinct valid observer count >= threshold, false otherwise
   */
  public validateQuorum(threshold: number, activeWhitelist?: string[]): boolean {
    if (threshold <= 0) {
      return false;
    }

    const effectiveWhitelist = activeWhitelist
      ? new Set(activeWhitelist.map((w) => w.trim()))
      : this.whitelist;

    let validCount = 0;
    for (const [observer] of this.attestations) {
      if (!effectiveWhitelist || effectiveWhitelist.has(observer)) {
        validCount++;
      }
    }

    return validCount >= threshold;
  }

  /**
   * Returns all ingested attestations sorted deterministically by observer public key.
   */
  public getAttestations(activeWhitelist?: string[]): ObserverAttestation[] {
    const effectiveWhitelist = activeWhitelist
      ? new Set(activeWhitelist.map((w) => w.trim()))
      : this.whitelist;

    const list: ObserverAttestation[] = [];
    for (const [observer, att] of this.attestations) {
      if (!effectiveWhitelist || effectiveWhitelist.has(observer)) {
        list.push(att);
      }
    }

    // Deterministic lexicographical ordering by observer address
    return list.sort((a, b) => a.observer.localeCompare(b.observer));
  }

  /**
   * Returns list of distinct observer public keys in deterministic order.
   */
  public getObservers(activeWhitelist?: string[]): string[] {
    return this.getAttestations(activeWhitelist).map((a) => a.observer);
  }

  /**
   * Returns count of current valid attestations.
   */
  public getCount(activeWhitelist?: string[]): number {
    return this.getAttestations(activeWhitelist).length;
  }

  /**
   * Checks whether a specific observer has submitted an attestation.
   */
  public hasObserver(observer: string): boolean {
    return this.attestations.has(observer.trim());
  }

  /**
   * Resets all stored attestations.
   */
  public clear(): void {
    this.attestations.clear();
  }

  /**
   * Generates finalization payload with deterministically sorted attestations and contract buffer.
   */
  public toFinalizationPayload(activeWhitelist?: string[]): FinalizeCaseArgs {
    const sortedAttestations = this.getAttestations(activeWhitelist);
    const observers = sortedAttestations.map((a) => a.observer);

    // Ensure 32-byte hex case ID parses to Buffer cleanly
    let caseIdBuf: Buffer;
    try {
      caseIdBuf = Buffer.from(this.caseId, "hex");
    } catch {
      caseIdBuf = Buffer.from(this.caseId, "utf-8");
    }

    return {
      caseId: this.caseId,
      case_id: caseIdBuf,
      attestations: sortedAttestations,
      observers,
      count: sortedAttestations.length,
    };
  }
}
