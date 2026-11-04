import { Buffer } from "buffer";
import { StrKey, Keypair } from "@stellar/stellar-sdk";

/**
 * Attestation submitted by an independent observer.
 */
export interface ObserverAttestation {
  caseId: string;
  observer: string;
  signature?: string;
  commitment: string;
  attestedAtLedger?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated payload passed to settlement finalization routines.
 */
export interface FinalizeCaseArgs {
  caseId: string;
  observerCount: number;
  observers: string[];
  attestations: ObserverAttestation[];
}

/**
 * Configuration options for ObserverSignatureAggregator.
 */
export interface AggregatorOptions {
  caseId?: string;
  activeWhitelist?: string[];
  requireSignatures?: boolean;
  verifySignatures?: boolean;
}

/**
 * Safely deep-clones JSON metadata, strictly rejecting non-serializable,
 * function, BigInt, symbol, or shared memory (SharedArrayBuffer) constructs.
 */
function deepCloneMetadata(meta?: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (meta === undefined) return undefined;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  try {
    const jsonStr = JSON.stringify(meta, (_k, v) => {
      if (typeof v === "bigint" || typeof v === "function" || typeof v === "symbol") {
        throw new TypeError("Unsupported metadata type");
      }
      if (
        typeof SharedArrayBuffer !== "undefined" &&
        (v instanceof SharedArrayBuffer || (ArrayBuffer.isView(v) && (v as any).buffer instanceof SharedArrayBuffer))
      ) {
        throw new TypeError("SharedArrayBuffer is not permitted in metadata");
      }
      return v;
    });
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Protocol Observer Signature Aggregator
 *
 * Collects, deduplicates, cryptographically validates, and batches independent observer
 * attestations for high-volume settlement workflows before finalization.
 */
export class ObserverSignatureAggregator {
  private _caseId?: string;
  private _whitelist?: Set<string>;
  private readonly _requireSignatures: boolean;
  private readonly _verifySignatures: boolean;
  private readonly _attestations: Map<string, ObserverAttestation> = new Map();

  constructor(caseIdOrOptions?: string | AggregatorOptions) {
    if (typeof caseIdOrOptions === "string") {
      const trimmed = caseIdOrOptions.trim();
      if (trimmed.length > 0) {
        this._caseId = trimmed.toLowerCase();
      }
      this._requireSignatures = false;
      this._verifySignatures = false;
    } else if (caseIdOrOptions && typeof caseIdOrOptions === "object") {
      if (typeof caseIdOrOptions.caseId === "string" && caseIdOrOptions.caseId.trim().length > 0) {
        this._caseId = caseIdOrOptions.caseId.trim().toLowerCase();
      }
      if (Array.isArray(caseIdOrOptions.activeWhitelist)) {
        this._whitelist = new Set(
          caseIdOrOptions.activeWhitelist
            .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
            .map((w) => w.trim())
        );
      }
      this._requireSignatures = Boolean(caseIdOrOptions.requireSignatures);
      this._verifySignatures = Boolean(caseIdOrOptions.verifySignatures);
    } else {
      this._requireSignatures = false;
      this._verifySignatures = false;
    }
  }

  /**
   * Bound case identifier (read-only).
   */
  public get caseId(): string | undefined {
    return this._caseId;
  }

  /**
   * Configured observer whitelist, if any.
   */
  public get whitelist(): string[] | undefined {
    return this._whitelist ? Array.from(this._whitelist).sort() : undefined;
  }

  /**
   * Sets or updates the active whitelist of authorized observer public keys.
   */
  public setWhitelist(whitelist: string[]): void {
    if (!Array.isArray(whitelist)) {
      throw new TypeError("Whitelist must be an array of Stellar public keys");
    }
    this._whitelist = new Set(
      whitelist
        .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
        .map((w) => w.trim())
    );
  }

  /**
   * Verifies an Ed25519 signature against an observer public key.
   */
  public verifySignature(attestation: ObserverAttestation): boolean {
    if (!attestation.signature || typeof attestation.signature !== "string") {
      return false;
    }
    const sigStr = attestation.signature.trim();
    if (sigStr.length === 0) {
      return false;
    }

    try {
      if (!StrKey.isValidEd25519PublicKey(attestation.observer)) {
        return false;
      }
      const keypair = Keypair.fromPublicKey(attestation.observer);
      const dataToVerify = new Uint8Array(
        Buffer.from(
          `${attestation.caseId.toLowerCase()}:${attestation.commitment.toLowerCase()}`,
          "utf-8"
        )
      );

      // Support hex (128 chars = 64 bytes) or base64 signature formats
      const sigBytes =
        sigStr.length === 128 && /^[0-9a-fA-F]+$/.test(sigStr)
          ? new Uint8Array(Buffer.from(sigStr, "hex"))
          : new Uint8Array(Buffer.from(sigStr, "base64"));

      return keypair.verify(dataToVerify, sigBytes);
    } catch {
      return false;
    }
  }

  /**
   * Adds an observer attestation to the aggregator.
   *
   * Validates structure, enforces case consistency, validates Stellar address format,
   * enforces whitelist (if configured), verifies signature (if required),
   * deep-clones metadata atomically, and strictly rejects duplicates.
   *
   * @param attestation The observer attestation to register
   * @returns true if accepted, false if rejected
   */
  public addAttestation(attestation: ObserverAttestation): boolean {
    if (!attestation || typeof attestation !== "object") {
      return false;
    }

    // Safely extract and check types
    const rawObserver = attestation.observer ?? (attestation as any).attestor;
    if (typeof rawObserver !== "string") {
      return false;
    }
    const observer = rawObserver.trim();

    if (typeof attestation.caseId !== "string") {
      return false;
    }
    const candidateCaseId = attestation.caseId.trim().toLowerCase();

    if (typeof attestation.commitment !== "string") {
      return false;
    }
    const commitment = attestation.commitment.trim().toLowerCase();

    if (observer.length === 0 || candidateCaseId.length === 0 || commitment.length === 0) {
      return false;
    }

    // Validate valid Stellar Ed25519 public key format
    if (!StrKey.isValidEd25519PublicKey(observer)) {
      return false;
    }

    // If caseId is already bound, check consistency
    if (this._caseId && this._caseId !== candidateCaseId) {
      return false;
    }

    // Whitelist check if active
    if (this._whitelist && !this._whitelist.has(observer)) {
      return false;
    }

    // Strict deduplication: reject duplicate submissions from same observer
    if (this._attestations.has(observer)) {
      return false;
    }

    // Signature validation if configured
    if (this._requireSignatures && !attestation.signature) {
      return false;
    }
    if ((this._verifySignatures || this._requireSignatures) && attestation.signature) {
      if (!this.verifySignature({ ...attestation, caseId: candidateCaseId, observer, commitment })) {
        return false;
      }
    }

    // Validate and atomically clone metadata BEFORE state mutation
    let clonedMeta: Record<string, unknown> | undefined = undefined;
    if (attestation.metadata !== undefined) {
      const cloned = deepCloneMetadata(attestation.metadata);
      if (cloned === null) {
        return false; // Metadata could not be cloned (e.g. contains functions, BigInt, symbols, SharedArrayBuffer)
      }
      clonedMeta = cloned;
    }

    // Atomically bind caseId and commit attestation to internal state
    if (!this._caseId) {
      this._caseId = candidateCaseId;
    }

    this._attestations.set(observer, {
      caseId: this._caseId,
      observer,
      commitment,
      signature: attestation.signature ? String(attestation.signature).trim() : undefined,
      attestedAtLedger:
        typeof attestation.attestedAtLedger === "number" ? attestation.attestedAtLedger : undefined,
      metadata: clonedMeta,
    });

    return true;
  }

  /**
   * Evaluates whether the collected attestations satisfy the required quorum.
   *
   * @param threshold Minimum number of distinct authorized observers required
   * @param activeWhitelist Optional array of currently authorized observer public keys
   * @returns true if distinct whitelisted observers >= threshold
   */
  public validateQuorum(threshold: number, activeWhitelist?: string[]): boolean {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return false;
    }

    if (this._attestations.size === 0) {
      return false;
    }

    const effectiveWhitelist =
      activeWhitelist && Array.isArray(activeWhitelist)
        ? new Set(
            activeWhitelist
              .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
              .map((w) => w.trim())
          )
        : this._whitelist;

    let validCount = 0;
    if (effectiveWhitelist) {
      for (const observer of this._attestations.keys()) {
        if (effectiveWhitelist.has(observer)) {
          validCount++;
        }
      }
    } else {
      validCount = this._attestations.size;
    }

    return validCount >= threshold;
  }

  /**
   * Builds the finalization arguments payload.
   *
   * Filters out unwhitelisted observers if an active whitelist is provided,
   * guarantees deterministic lexicographical ordering by observer key,
   * and returns defensively deep-copied objects.
   *
   * @param activeWhitelist Optional whitelist to filter eligible attestations
   * @returns Deterministically ordered FinalizeCaseArgs payload
   */
  public toFinalizationPayload(activeWhitelist?: string[]): FinalizeCaseArgs {
    const effectiveWhitelist =
      activeWhitelist && Array.isArray(activeWhitelist)
        ? new Set(
            activeWhitelist
              .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
              .map((w) => w.trim())
          )
        : this._whitelist;

    let candidateAttestations: ObserverAttestation[] = Array.from(this._attestations.values()).map(
      (a) => ({
        ...a,
        metadata: deepCloneMetadata(a.metadata) ?? undefined,
      })
    );

    if (effectiveWhitelist) {
      candidateAttestations = candidateAttestations.filter((a) =>
        effectiveWhitelist.has(a.observer)
      );
    }

    // Guarantee deterministic ordering by observer address
    candidateAttestations.sort((a, b) => a.observer.localeCompare(b.observer));

    return {
      caseId: this._caseId ?? "",
      observerCount: candidateAttestations.length,
      observers: candidateAttestations.map((a) => a.observer),
      attestations: candidateAttestations,
    };
  }

  /**
   * Checks whether an observer has already submitted an attestation.
   */
  public hasObserver(observer: string): boolean {
    if (!observer || typeof observer !== "string") return false;
    return this._attestations.has(observer.trim());
  }

  /**
   * Retrieves an attestation by observer public key (returns defensive deep copy).
   */
  public getAttestation(observer: string): ObserverAttestation | undefined {
    if (!observer || typeof observer !== "string") return undefined;
    const stored = this._attestations.get(observer.trim());
    if (!stored) return undefined;
    return {
      ...stored,
      metadata: deepCloneMetadata(stored.metadata) ?? undefined,
    };
  }

  /**
   * Returns all stored attestations in deterministic order (returns defensive deep copies).
   */
  public getAttestations(): ObserverAttestation[] {
    return Array.from(this._attestations.values())
      .map((a) => ({ ...a, metadata: deepCloneMetadata(a.metadata) ?? undefined }))
      .sort((a, b) => a.observer.localeCompare(b.observer));
  }

  /**
   * Returns all distinct observer addresses in deterministic order.
   */
  public getObservers(): string[] {
    return Array.from(this._attestations.keys()).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Returns the count of distinct collected attestations.
   */
  public get size(): number {
    return this._attestations.size;
  }

  /**
   * Resets all stored attestations.
   */
  public clear(): void {
    this._attestations.clear();
  }
}
