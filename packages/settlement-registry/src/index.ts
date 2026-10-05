import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export * from "./release.js";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




/**
 * Reconciliation decision recorded on-chain by a registered observer.
 */
export type Decision = {tag: "None", values: void} | {tag: "Matched", values: void} | {tag: "Break", values: readonly [BreakCode]};

/**
 * Standardized classification for reconciliation breaks.
 */
export type BreakCode = {tag: "AmountMismatch", values: void} | {tag: "AssetMismatch", values: void} | {tag: "DestinationMismatch", values: void} | {tag: "ReferenceMismatch", values: void} | {tag: "MissingSettlement", values: void} | {tag: "DuplicateSettlement", values: void} | {tag: "LateSettlement", values: void} | {tag: "FailedTransaction", values: void} | {tag: "UnexpectedTransaction", values: void};

/**
 * Lifecycle state for a settlement case.
 */
export type CaseStatus = {tag: "Open", values: void} | {tag: "Observed", values: void} | {tag: "Matched", values: void} | {tag: "Break", values: void} | {tag: "Disputed", values: void} | {tag: "Resolved", values: void} | {tag: "Finalized", values: void};


/**
 * Cryptographic attestation anchoring an authorized party's confirmation.
 */
export interface Attestation {
  /**
 * Stellar ledger sequence when attestation was recorded.
 */
attested_at_ledger: u32;
  /**
 * 32-byte commitment payload.
 */
commitment: Buffer;
  /**
 * Role under which this attestation was submitted.
 */
role: AttestationRole;
}

/**
 * Settlement observation state for a case.
 */
export type Observation = {tag: "None", values: void} | {tag: "Observed", values: readonly [ObservationRecord]};


/**
 * Core protocol object anchoring settlement terms, observations, and decisions.
 */
export interface SettlementCase {
  /**
 * Optional counterparty address expected to participate or settle.
 */
counterparty: Option<string>;
  /**
 * Ledger sequence when the case was created.
 */
created_at_ledger: u32;
  /**
 * Reconciliation decision.
 */
decision: Decision;
  /**
 * Ledger sequence when an active dispute expires, if disputed.
 */
dispute_expires_at_ledger: Option<u32>;
  /**
 * Expiration ledger sequence for settlement.
 */
expires_at_ledger: u32;
  /**
 * Ledger sequence when the case reached finalization.
 */
finalized_at_ledger: Option<u32>;
  /**
 * Settlement observation recorded by an authorized observer.
 */
observation: Observation;
  /**
 * Minimum required distinct observer attestations for finalization.
 */
observer_quorum: u32;
  /**
 * Initiating owner / originator of the settlement case.
 */
owner: string;
  /**
 * Current lifecycle state.
 */
status: CaseStatus;
  /**
 * 32-byte hash commitment of expected settlement terms.
 */
terms_commitment: Buffer;
}

/**
 * Participant role for an attestation.
 */
export type AttestationRole = {tag: "Owner", values: void} | {tag: "Counterparty", values: void} | {tag: "Observer", values: void};


/**
 * Stellar settlement observation details recorded by an observer.
 */
export interface ObservationRecord {
  /**
 * Opaque 32-byte cryptographic commitment to observation details.
 */
observation_commitment: Buffer;
  /**
 * Stellar ledger sequence where the transaction occurred.
 */
observed_ledger: u32;
  /**
 * Stellar transaction hash where settlement was observed.
 */
tx_hash: Buffer;
}

/**
 * Typed contract errors with stable numeric discriminants for StellarClear SettlementRegistry.
 */
export const Errors = {
  /**
   * Contract is already initialized.
   */
  1: {message:"AlreadyInitialized"},
  /**
   * Requested record was not found.
   */
  2: {message:"NotFound"},
  /**
   * Case with the given identifier already exists.
   */
  3: {message:"CaseAlreadyExists"},
  /**
   * Observer address is already registered in the registry.
   */
  4: {message:"ObserverAlreadyRegistered"},
  /**
   * Observer address is not registered in the registry.
   */
  5: {message:"ObserverNotRegistered"},
  /**
   * Caller is not authorized to perform the operation.
   */
  6: {message:"Unauthorized"},
  /**
   * Target case is not in a valid state for the requested operation.
   */
  7: {message:"InvalidState"},
  /**
   * Expiration ledger must be strictly greater than the current ledger.
   */
  8: {message:"InvalidExpiration"},
  /**
   * Commitment is invalid or all zeros.
   */
  9: {message:"InvalidCommitment"},
  /**
   * Operation requires a counterparty, but none was defined on the case.
   */
  10: {message:"CounterpartyRequired"},
  /**
   * Counterparty cannot be the same as the case owner.
   */
  11: {message:"CounterpartyNotAllowed"},
  /**
   * Attestation already submitted by this address for the specified case.
   */
  12: {message:"AttestationAlreadyExists"},
  /**
   * Resolution commitment has already been submitted by this party.
   */
  13: {message:"ResolutionAlreadySubmitted"},
  /**
   * Resolution commitments between owner and counterparty do not match.
   */
  14: {message:"ResolutionMismatch"},
  /**
   * Required attestation is missing to finalize the case.
   */
  15: {message:"MissingRequiredAttestation"},
  /**
   * Decision is invalid for the case state.
   */
  16: {message:"InvalidDecision"},
  /**
   * Observation ledger is zero or in the future relative to current ledger.
   */
  17: {message:"InvalidLedger"},
  /**
   * Observer quorum threshold must be a positive integer.
   */
  18: {message:"InvalidObserverQuorum"},
  /**
   * Required observer quorum threshold was not met.
   */
  19: {message:"ObserverQuorumNotMet"},
  /**
   * Dispute has not yet expired; current ledger sequence is before the expiration ledger.
   */
  20: {message:"DisputeNotExpired"},
  /**
   * Dispute has already expired; resolution submissions are no longer accepted.
   */
  21: {message:"DisputeAlreadyExpired"}
}














/**
 * Storage key definitions for instance and persistent contract storage.
 */
export type DataKey = {tag: "Admin", values: void} | {tag: "ContractVersion", values: void} | {tag: "Observer", values: readonly [string]} | {tag: "Case", values: readonly [Buffer]} | {tag: "CaseObserver", values: readonly [Buffer]} | {tag: "Attestation", values: readonly [Buffer, string]} | {tag: "Resolution", values: readonly [Buffer, string]} | {tag: "CaseQuorum", values: readonly [Buffer]} | {tag: "CaseAttestedObservers", values: readonly [Buffer]} | {tag: "DisputeExpiration", values: readonly [Buffer]};

export interface Client {
  /**
   * Construct and simulate a get_case transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reads a settlement case record by ID.
   */
  get_case: ({case_id}: {case_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SettlementCase>>>

  /**
   * Construct and simulate a create_case transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-authorized: opens a new settlement case with terms commitment and expiry.
   */
  create_case: ({case_id, owner, counterparty, terms_commitment, expires_at_ledger}: {case_id: Buffer, owner: string, counterparty: Option<string>, terms_commitment: Buffer, expires_at_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_observer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Checks whether an address is a registered observer.
   */
  is_observer: ({observer}: {observer: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_observer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: registers a new authorized settlement observer.
   */
  add_observer: ({observer}: {observer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a open_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner or Counterparty: opens a dispute against a broken settlement case.
   */
  open_dispute: ({initiator, case_id, dispute_commitment}: {initiator: string, case_id: Buffer, dispute_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a record_break transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Observer-authorized: records a reconciliation break decision with standardized break code.
   */
  record_break: ({observer, case_id, break_code}: {observer: string, case_id: Buffer, break_code: BreakCode}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a record_match transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Observer-authorized: records a matched reconciliation decision.
   */
  record_match: ({observer, case_id}: {observer: string, case_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a finalize_case transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-authorized: finalizes a matched or resolved settlement case.
   */
  finalize_case: ({case_id}: {case_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a expire_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless: triggers expiration of an unaddressed dispute after TTL expires.
   * Transitions case back to Break with auto-break resolution.
   */
  expire_dispute: ({case_id}: {case_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_resolution transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reads a resolution commitment by case ID and resolver address.
   */
  get_resolution: ({case_id, resolver}: {case_id: Buffer, resolver: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reads an attestation record by case ID and attestor address.
   */
  get_attestation: ({case_id, attestor}: {case_id: Buffer, attestor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Attestation>>>

  /**
   * Construct and simulate a get_case_quorum transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reads the configured observer quorum threshold for a case.
   */
  get_case_quorum: ({case_id}: {case_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a remove_observer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: revokes an authorized settlement observer.
   */
  remove_observer: ({observer}: {observer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_case_quorum transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner-authorized: configures the required observer quorum threshold for a case.
   */
  set_case_quorum: ({case_id, quorum}: {case_id: Buffer, quorum: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_resolution transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner or Counterparty: submits two-party resolution commitment.
   */
  submit_resolution: ({resolver, case_id, resolution_commitment}: {resolver: string, case_id: Buffer, resolution_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a record_observation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Observer-authorized: records an observed settlement transaction for an open case.
   */
  record_observation: ({observer, case_id, tx_hash, observed_ledger, observation_commitment}: {observer: string, case_id: Buffer, tx_hash: Buffer, observed_ledger: u32, observation_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submits a cryptographic attestation for an active settlement case.
   */
  submit_attestation: ({case_id, role, commitment}: {case_id: Buffer, role: AttestationRole, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a open_dispute_with_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner or Counterparty: opens a dispute against a broken settlement case with custom TTL ledgers.
   */
  open_dispute_with_ttl: ({initiator, case_id, dispute_commitment, ttl_ledgers}: {initiator: string, case_id: Buffer, dispute_commitment: Buffer, ttl_ledgers: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_attested_observers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reads the list of distinct observer addresses that submitted attestations for a case.
   */
  get_attested_observers: ({case_id}: {case_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_dispute_expiration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reads the dispute expiration ledger sequence for an active dispute, if any.
   */
  get_dispute_expiration: ({case_id}: {case_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a submit_observer_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Observer-authorized: submits an attestation as a registered observer.
   * Used for multi-observer quorum where multiple distinct observers submit attestations.
   */
  submit_observer_attestation: ({case_id, observer, commitment}: {case_id: Buffer, observer: string, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin}: {admin: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAACVSZWFkcyBhIHNldHRsZW1lbnQgY2FzZSByZWNvcmQgYnkgSUQuAAAAAAAACGdldF9jYXNlAAAAAQAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAAA5TZXR0bGVtZW50Q2FzZQAAAAAAAw==",
        "AAAAAAAAAE9Pd25lci1hdXRob3JpemVkOiBvcGVucyBhIG5ldyBzZXR0bGVtZW50IGNhc2Ugd2l0aCB0ZXJtcyBjb21taXRtZW50IGFuZCBleHBpcnkuAAAAAAtjcmVhdGVfY2FzZQAAAAAFAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAADGNvdW50ZXJwYXJ0eQAAA+gAAAATAAAAAAAAABB0ZXJtc19jb21taXRtZW50AAAD7gAAACAAAAAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADNDaGVja3Mgd2hldGhlciBhbiBhZGRyZXNzIGlzIGEgcmVnaXN0ZXJlZCBvYnNlcnZlci4AAAAAC2lzX29ic2VydmVyAAAAAAEAAAAAAAAACG9ic2VydmVyAAAAEwAAAAEAAAAB",
        "AAAAAAAAADtBZG1pbi1vbmx5OiByZWdpc3RlcnMgYSBuZXcgYXV0aG9yaXplZCBzZXR0bGVtZW50IG9ic2VydmVyLgAAAAAMYWRkX29ic2VydmVyAAAAAQAAAAAAAAAIb2JzZXJ2ZXIAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEhPd25lciBvciBDb3VudGVycGFydHk6IG9wZW5zIGEgZGlzcHV0ZSBhZ2FpbnN0IGEgYnJva2VuIHNldHRsZW1lbnQgY2FzZS4AAAAMb3Blbl9kaXNwdXRlAAAAAwAAAAAAAAAJaW5pdGlhdG9yAAAAAAAAEwAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAAAAAASZGlzcHV0ZV9jb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAFpPYnNlcnZlci1hdXRob3JpemVkOiByZWNvcmRzIGEgcmVjb25jaWxpYXRpb24gYnJlYWsgZGVjaXNpb24gd2l0aCBzdGFuZGFyZGl6ZWQgYnJlYWsgY29kZS4AAAAAAAxyZWNvcmRfYnJlYWsAAAADAAAAAAAAAAhvYnNlcnZlcgAAABMAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAAAAAAACmJyZWFrX2NvZGUAAAAAB9AAAAAJQnJlYWtDb2RlAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAD9PYnNlcnZlci1hdXRob3JpemVkOiByZWNvcmRzIGEgbWF0Y2hlZCByZWNvbmNpbGlhdGlvbiBkZWNpc2lvbi4AAAAADHJlY29yZF9tYXRjaAAAAAIAAAAAAAAACG9ic2VydmVyAAAAEwAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAx5PbmUtdGltZSBjb25zdHJ1Y3RvciBpbml0aWFsaXppbmcgdGhlIGNvbnRyYWN0IGFkbWluaXN0cmF0b3IgYW5kIHByb3RvY29sIHZlcnNpb24uCgojIEluZGV4ZXIgRXZlbnRzIEVtaXR0ZWQ6Ci0gYENhc2VDcmVhdGVkYDogZW1pdHRlZCBvbiBgY3JlYXRlX2Nhc2VgCi0gYE9ic2VydmF0aW9uUmVjb3JkZWRgOiBlbWl0dGVkIG9uIGByZWNvcmRfb2JzZXJ2YXRpb25gCi0gYENhc2VNYXRjaGVkYDogZW1pdHRlZCBvbiBgcmVjb3JkX21hdGNoYAotIGBDYXNlQnJva2VuYDogZW1pdHRlZCBvbiBgcmVjb3JkX2JyZWFrYAotIGBBdHRlc3RhdGlvblN1Ym1pdHRlZGA6IGVtaXR0ZWQgb24gYHN1Ym1pdF9hdHRlc3RhdGlvbmAKLSBgRGlzcHV0ZU9wZW5lZGA6IGVtaXR0ZWQgb24gYG9wZW5fZGlzcHV0ZWAKLSBgUmVzb2x1dGlvblN1Ym1pdHRlZGAgJiBgRGlzcHV0ZVJlc29sdmVkYDogZW1pdHRlZCBvbiBgc3VibWl0X3Jlc29sdXRpb25gCi0gYENhc2VGaW5hbGl6ZWRgOiBlbWl0dGVkIG9uIGBmaW5hbGl6ZV9jYXNlYAotIGBPYnNlcnZlckFkZGVkYCAmIGBPYnNlcnZlclJlbW92ZWRgOiBlbWl0dGVkIG9uIG9ic2VydmVyIHJlZ2lzdHJhdGlvbiBsaWZlY3ljbGUKCiMgU2V0dGxlbWVudCBMaWZlY3ljbGUgVHJhbnNpdGlvbnMgU3VwcG9ydGVkOgotIE9wZW4gLT4gT2JzZXJ2ZWQKLSBPYnNlcnZlZCAtPiBNYXRjaGVkCi0gT2JzZXJ2ZWQgLT4gQnJlYWsKLSBCcmVhayAtPiBEaXNwdXRlZAotIERpc3B1dGVkIC0+IFJlc29sdmVkCi0gTWF0Y2hlZCAtPiBGaW5hbGl6ZWQKLSBSZXNvbHZlZCAtPiBGaW5hbGl6ZWQAAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEJPd25lci1hdXRob3JpemVkOiBmaW5hbGl6ZXMgYSBtYXRjaGVkIG9yIHJlc29sdmVkIHNldHRsZW1lbnQgY2FzZS4AAAAAAA1maW5hbGl6ZV9jYXNlAAAAAAAAAQAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAItQZXJtaXNzaW9ubGVzczogdHJpZ2dlcnMgZXhwaXJhdGlvbiBvZiBhbiB1bmFkZHJlc3NlZCBkaXNwdXRlIGFmdGVyIFRUTCBleHBpcmVzLgpUcmFuc2l0aW9ucyBjYXNlIGJhY2sgdG8gQnJlYWsgd2l0aCBhdXRvLWJyZWFrIHJlc29sdXRpb24uAAAAAA5leHBpcmVfZGlzcHV0ZQAAAAAAAQAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAD5SZWFkcyBhIHJlc29sdXRpb24gY29tbWl0bWVudCBieSBjYXNlIElEIGFuZCByZXNvbHZlciBhZGRyZXNzLgAAAAAADmdldF9yZXNvbHV0aW9uAAAAAAACAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAAAAAAhyZXNvbHZlcgAAABMAAAABAAAD6AAAA+4AAAAg",
        "AAAAAAAAADxSZWFkcyBhbiBhdHRlc3RhdGlvbiByZWNvcmQgYnkgY2FzZSBJRCBhbmQgYXR0ZXN0b3IgYWRkcmVzcy4AAAAPZ2V0X2F0dGVzdGF0aW9uAAAAAAIAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAAAAAAACGF0dGVzdG9yAAAAEwAAAAEAAAPoAAAH0AAAAAtBdHRlc3RhdGlvbgA=",
        "AAAAAAAAADpSZWFkcyB0aGUgY29uZmlndXJlZCBvYnNlcnZlciBxdW9ydW0gdGhyZXNob2xkIGZvciBhIGNhc2UuAAAAAAAPZ2V0X2Nhc2VfcXVvcnVtAAAAAAEAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAABAAAABA==",
        "AAAAAAAAADZBZG1pbi1vbmx5OiByZXZva2VzIGFuIGF1dGhvcml6ZWQgc2V0dGxlbWVudCBvYnNlcnZlci4AAAAAAA9yZW1vdmVfb2JzZXJ2ZXIAAAAAAQAAAAAAAAAIb2JzZXJ2ZXIAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAE9Pd25lci1hdXRob3JpemVkOiBjb25maWd1cmVzIHRoZSByZXF1aXJlZCBvYnNlcnZlciBxdW9ydW0gdGhyZXNob2xkIGZvciBhIGNhc2UuAAAAAA9zZXRfY2FzZV9xdW9ydW0AAAAAAgAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAAAAAAGcXVvcnVtAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAD9Pd25lciBvciBDb3VudGVycGFydHk6IHN1Ym1pdHMgdHdvLXBhcnR5IHJlc29sdXRpb24gY29tbWl0bWVudC4AAAAAEXN1Ym1pdF9yZXNvbHV0aW9uAAAAAAAAAwAAAAAAAAAIcmVzb2x2ZXIAAAATAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAAAAABVyZXNvbHV0aW9uX2NvbW1pdG1lbnQAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAFFPYnNlcnZlci1hdXRob3JpemVkOiByZWNvcmRzIGFuIG9ic2VydmVkIHNldHRsZW1lbnQgdHJhbnNhY3Rpb24gZm9yIGFuIG9wZW4gY2FzZS4AAAAAAAAScmVjb3JkX29ic2VydmF0aW9uAAAAAAAFAAAAAAAAAAhvYnNlcnZlcgAAABMAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAAAAAAAB3R4X2hhc2gAAAAD7gAAACAAAAAAAAAAD29ic2VydmVkX2xlZGdlcgAAAAAEAAAAAAAAABZvYnNlcnZhdGlvbl9jb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAEJTdWJtaXRzIGEgY3J5cHRvZ3JhcGhpYyBhdHRlc3RhdGlvbiBmb3IgYW4gYWN0aXZlIHNldHRsZW1lbnQgY2FzZS4AAAAAABJzdWJtaXRfYXR0ZXN0YXRpb24AAAAAAAMAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAAAAAAABHJvbGUAAAfQAAAAD0F0dGVzdGF0aW9uUm9sZQAAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAGBPd25lciBvciBDb3VudGVycGFydHk6IG9wZW5zIGEgZGlzcHV0ZSBhZ2FpbnN0IGEgYnJva2VuIHNldHRsZW1lbnQgY2FzZSB3aXRoIGN1c3RvbSBUVEwgbGVkZ2Vycy4AAAAVb3Blbl9kaXNwdXRlX3dpdGhfdHRsAAAAAAAABAAAAAAAAAAJaW5pdGlhdG9yAAAAAAAAEwAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAAAAAASZGlzcHV0ZV9jb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAALdHRsX2xlZGdlcnMAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAFVSZWFkcyB0aGUgbGlzdCBvZiBkaXN0aW5jdCBvYnNlcnZlciBhZGRyZXNzZXMgdGhhdCBzdWJtaXR0ZWQgYXR0ZXN0YXRpb25zIGZvciBhIGNhc2UuAAAAAAAAFmdldF9hdHRlc3RlZF9vYnNlcnZlcnMAAAAAAAEAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAABAAAD6gAAABM=",
        "AAAAAAAAAEtSZWFkcyB0aGUgZGlzcHV0ZSBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgYW4gYWN0aXZlIGRpc3B1dGUsIGlmIGFueS4AAAAAFmdldF9kaXNwdXRlX2V4cGlyYXRpb24AAAAAAAEAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAABAAAD6AAAAAQ=",
        "AAAAAAAAAJtPYnNlcnZlci1hdXRob3JpemVkOiBzdWJtaXRzIGFuIGF0dGVzdGF0aW9uIGFzIGEgcmVnaXN0ZXJlZCBvYnNlcnZlci4KVXNlZCBmb3IgbXVsdGktb2JzZXJ2ZXIgcXVvcnVtIHdoZXJlIG11bHRpcGxlIGRpc3RpbmN0IG9ic2VydmVycyBzdWJtaXQgYXR0ZXN0YXRpb25zLgAAAAAbc3VibWl0X29ic2VydmVyX2F0dGVzdGF0aW9uAAAAAAMAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAAAAAAACG9ic2VydmVyAAAAEwAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAgAAAENSZWNvbmNpbGlhdGlvbiBkZWNpc2lvbiByZWNvcmRlZCBvbi1jaGFpbiBieSBhIHJlZ2lzdGVyZWQgb2JzZXJ2ZXIuAAAAAAAAAAAIRGVjaXNpb24AAAADAAAAAAAAAAAAAAAETm9uZQAAAAAAAAAAAAAAB01hdGNoZWQAAAAAAQAAAAAAAAAFQnJlYWsAAAAAAAABAAAH0AAAAAlCcmVha0NvZGUAAAA=",
        "AAAAAgAAADZTdGFuZGFyZGl6ZWQgY2xhc3NpZmljYXRpb24gZm9yIHJlY29uY2lsaWF0aW9uIGJyZWFrcy4AAAAAAAAAAAAJQnJlYWtDb2RlAAAAAAAACQAAAAAAAAAAAAAADkFtb3VudE1pc21hdGNoAAAAAAAAAAAAAAAAAA1Bc3NldE1pc21hdGNoAAAAAAAAAAAAAAAAAAATRGVzdGluYXRpb25NaXNtYXRjaAAAAAAAAAAAAAAAABFSZWZlcmVuY2VNaXNtYXRjaAAAAAAAAAAAAAAAAAAAEU1pc3NpbmdTZXR0bGVtZW50AAAAAAAAAAAAAAAAAAATRHVwbGljYXRlU2V0dGxlbWVudAAAAAAAAAAAAAAAAA5MYXRlU2V0dGxlbWVudAAAAAAAAAAAAAAAAAARRmFpbGVkVHJhbnNhY3Rpb24AAAAAAAAAAAAAAAAAABVVbmV4cGVjdGVkVHJhbnNhY3Rpb24AAAA=",
        "AAAAAgAAACZMaWZlY3ljbGUgc3RhdGUgZm9yIGEgc2V0dGxlbWVudCBjYXNlLgAAAAAAAAAAAApDYXNlU3RhdHVzAAAAAAAHAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAACE9ic2VydmVkAAAAAAAAAAAAAAAHTWF0Y2hlZAAAAAAAAAAAAAAAAAVCcmVhawAAAAAAAAAAAAAAAAAACERpc3B1dGVkAAAAAAAAAAAAAAAIUmVzb2x2ZWQAAAAAAAAAAAAAAAlGaW5hbGl6ZWQAAAA=",
        "AAAAAQAAAEdDcnlwdG9ncmFwaGljIGF0dGVzdGF0aW9uIGFuY2hvcmluZyBhbiBhdXRob3JpemVkIHBhcnR5J3MgY29uZmlybWF0aW9uLgAAAAAAAAAAC0F0dGVzdGF0aW9uAAAAAAMAAAA2U3RlbGxhciBsZWRnZXIgc2VxdWVuY2Ugd2hlbiBhdHRlc3RhdGlvbiB3YXMgcmVjb3JkZWQuAAAAAAASYXR0ZXN0ZWRfYXRfbGVkZ2VyAAAAAAAEAAAAGzMyLWJ5dGUgY29tbWl0bWVudCBwYXlsb2FkLgAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAwUm9sZSB1bmRlciB3aGljaCB0aGlzIGF0dGVzdGF0aW9uIHdhcyBzdWJtaXR0ZWQuAAAABHJvbGUAAAfQAAAAD0F0dGVzdGF0aW9uUm9sZQA=",
        "AAAAAgAAAChTZXR0bGVtZW50IG9ic2VydmF0aW9uIHN0YXRlIGZvciBhIGNhc2UuAAAAAAAAAAtPYnNlcnZhdGlvbgAAAAACAAAAAAAAAAAAAAAETm9uZQAAAAEAAAAAAAAACE9ic2VydmVkAAAAAQAAB9AAAAART2JzZXJ2YXRpb25SZWNvcmQAAAA=",
        "AAAAAQAAAE1Db3JlIHByb3RvY29sIG9iamVjdCBhbmNob3Jpbmcgc2V0dGxlbWVudCB0ZXJtcywgb2JzZXJ2YXRpb25zLCBhbmQgZGVjaXNpb25zLgAAAAAAAAAAAAAOU2V0dGxlbWVudENhc2UAAAAAAAsAAABAT3B0aW9uYWwgY291bnRlcnBhcnR5IGFkZHJlc3MgZXhwZWN0ZWQgdG8gcGFydGljaXBhdGUgb3Igc2V0dGxlLgAAAAxjb3VudGVycGFydHkAAAPoAAAAEwAAACpMZWRnZXIgc2VxdWVuY2Ugd2hlbiB0aGUgY2FzZSB3YXMgY3JlYXRlZC4AAAAAABFjcmVhdGVkX2F0X2xlZGdlcgAAAAAAAAQAAAAYUmVjb25jaWxpYXRpb24gZGVjaXNpb24uAAAACGRlY2lzaW9uAAAH0AAAAAhEZWNpc2lvbgAAADxMZWRnZXIgc2VxdWVuY2Ugd2hlbiBhbiBhY3RpdmUgZGlzcHV0ZSBleHBpcmVzLCBpZiBkaXNwdXRlZC4AAAAZZGlzcHV0ZV9leHBpcmVzX2F0X2xlZGdlcgAAAAAAA+gAAAAEAAAAKkV4cGlyYXRpb24gbGVkZ2VyIHNlcXVlbmNlIGZvciBzZXR0bGVtZW50LgAAAAAAEWV4cGlyZXNfYXRfbGVkZ2VyAAAAAAAABAAAADNMZWRnZXIgc2VxdWVuY2Ugd2hlbiB0aGUgY2FzZSByZWFjaGVkIGZpbmFsaXphdGlvbi4AAAAAE2ZpbmFsaXplZF9hdF9sZWRnZXIAAAAD6AAAAAQAAAA6U2V0dGxlbWVudCBvYnNlcnZhdGlvbiByZWNvcmRlZCBieSBhbiBhdXRob3JpemVkIG9ic2VydmVyLgAAAAAAC29ic2VydmF0aW9uAAAAB9AAAAALT2JzZXJ2YXRpb24AAAAAQU1pbmltdW0gcmVxdWlyZWQgZGlzdGluY3Qgb2JzZXJ2ZXIgYXR0ZXN0YXRpb25zIGZvciBmaW5hbGl6YXRpb24uAAAAAAAAD29ic2VydmVyX3F1b3J1bQAAAAAEAAAANUluaXRpYXRpbmcgb3duZXIgLyBvcmlnaW5hdG9yIG9mIHRoZSBzZXR0bGVtZW50IGNhc2UuAAAAAAAABW93bmVyAAAAAAAAEwAAABhDdXJyZW50IGxpZmVjeWNsZSBzdGF0ZS4AAAAGc3RhdHVzAAAAAAfQAAAACkNhc2VTdGF0dXMAAAAAADUzMi1ieXRlIGhhc2ggY29tbWl0bWVudCBvZiBleHBlY3RlZCBzZXR0bGVtZW50IHRlcm1zLgAAAAAAABB0ZXJtc19jb21taXRtZW50AAAD7gAAACA=",
        "AAAAAgAAACRQYXJ0aWNpcGFudCByb2xlIGZvciBhbiBhdHRlc3RhdGlvbi4AAAAAAAAAD0F0dGVzdGF0aW9uUm9sZQAAAAADAAAAAAAAAAAAAAAFT3duZXIAAAAAAAAAAAAAAAAAAAxDb3VudGVycGFydHkAAAAAAAAAAAAAAAhPYnNlcnZlcg==",
        "AAAAAQAAAD9TdGVsbGFyIHNldHRsZW1lbnQgb2JzZXJ2YXRpb24gZGV0YWlscyByZWNvcmRlZCBieSBhbiBvYnNlcnZlci4AAAAAAAAAABFPYnNlcnZhdGlvblJlY29yZAAAAAAAAAMAAAA/T3BhcXVlIDMyLWJ5dGUgY3J5cHRvZ3JhcGhpYyBjb21taXRtZW50IHRvIG9ic2VydmF0aW9uIGRldGFpbHMuAAAAABZvYnNlcnZhdGlvbl9jb21taXRtZW50AAAAAAPuAAAAIAAAADdTdGVsbGFyIGxlZGdlciBzZXF1ZW5jZSB3aGVyZSB0aGUgdHJhbnNhY3Rpb24gb2NjdXJyZWQuAAAAAA9vYnNlcnZlZF9sZWRnZXIAAAAABAAAADdTdGVsbGFyIHRyYW5zYWN0aW9uIGhhc2ggd2hlcmUgc2V0dGxlbWVudCB3YXMgb2JzZXJ2ZWQuAAAAAAd0eF9oYXNoAAAAA+4AAAAg",
        "AAAABAAAAFxUeXBlZCBjb250cmFjdCBlcnJvcnMgd2l0aCBzdGFibGUgbnVtZXJpYyBkaXNjcmltaW5hbnRzIGZvciBTdGVsbGFyQ2xlYXIgU2V0dGxlbWVudFJlZ2lzdHJ5LgAAAAAAAAAFRXJyb3IAAAAAAAAVAAAAIENvbnRyYWN0IGlzIGFscmVhZHkgaW5pdGlhbGl6ZWQuAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAB9SZXF1ZXN0ZWQgcmVjb3JkIHdhcyBub3QgZm91bmQuAAAAAAhOb3RGb3VuZAAAAAIAAAAuQ2FzZSB3aXRoIHRoZSBnaXZlbiBpZGVudGlmaWVyIGFscmVhZHkgZXhpc3RzLgAAAAAAEUNhc2VBbHJlYWR5RXhpc3RzAAAAAAAAAwAAADdPYnNlcnZlciBhZGRyZXNzIGlzIGFscmVhZHkgcmVnaXN0ZXJlZCBpbiB0aGUgcmVnaXN0cnkuAAAAABlPYnNlcnZlckFscmVhZHlSZWdpc3RlcmVkAAAAAAAABAAAADNPYnNlcnZlciBhZGRyZXNzIGlzIG5vdCByZWdpc3RlcmVkIGluIHRoZSByZWdpc3RyeS4AAAAAFU9ic2VydmVyTm90UmVnaXN0ZXJlZAAAAAAAAAUAAAAyQ2FsbGVyIGlzIG5vdCBhdXRob3JpemVkIHRvIHBlcmZvcm0gdGhlIG9wZXJhdGlvbi4AAAAAAAxVbmF1dGhvcml6ZWQAAAAGAAAAQFRhcmdldCBjYXNlIGlzIG5vdCBpbiBhIHZhbGlkIHN0YXRlIGZvciB0aGUgcmVxdWVzdGVkIG9wZXJhdGlvbi4AAAAMSW52YWxpZFN0YXRlAAAABwAAAENFeHBpcmF0aW9uIGxlZGdlciBtdXN0IGJlIHN0cmljdGx5IGdyZWF0ZXIgdGhhbiB0aGUgY3VycmVudCBsZWRnZXIuAAAAABFJbnZhbGlkRXhwaXJhdGlvbgAAAAAAAAgAAAAjQ29tbWl0bWVudCBpcyBpbnZhbGlkIG9yIGFsbCB6ZXJvcy4AAAAAEUludmFsaWRDb21taXRtZW50AAAAAAAACQAAAERPcGVyYXRpb24gcmVxdWlyZXMgYSBjb3VudGVycGFydHksIGJ1dCBub25lIHdhcyBkZWZpbmVkIG9uIHRoZSBjYXNlLgAAABRDb3VudGVycGFydHlSZXF1aXJlZAAAAAoAAAAyQ291bnRlcnBhcnR5IGNhbm5vdCBiZSB0aGUgc2FtZSBhcyB0aGUgY2FzZSBvd25lci4AAAAAABZDb3VudGVycGFydHlOb3RBbGxvd2VkAAAAAAALAAAARUF0dGVzdGF0aW9uIGFscmVhZHkgc3VibWl0dGVkIGJ5IHRoaXMgYWRkcmVzcyBmb3IgdGhlIHNwZWNpZmllZCBjYXNlLgAAAAAAABhBdHRlc3RhdGlvbkFscmVhZHlFeGlzdHMAAAAMAAAAP1Jlc29sdXRpb24gY29tbWl0bWVudCBoYXMgYWxyZWFkeSBiZWVuIHN1Ym1pdHRlZCBieSB0aGlzIHBhcnR5LgAAAAAaUmVzb2x1dGlvbkFscmVhZHlTdWJtaXR0ZWQAAAAAAA0AAABDUmVzb2x1dGlvbiBjb21taXRtZW50cyBiZXR3ZWVuIG93bmVyIGFuZCBjb3VudGVycGFydHkgZG8gbm90IG1hdGNoLgAAAAASUmVzb2x1dGlvbk1pc21hdGNoAAAAAAAOAAAANVJlcXVpcmVkIGF0dGVzdGF0aW9uIGlzIG1pc3NpbmcgdG8gZmluYWxpemUgdGhlIGNhc2UuAAAAAAAAGk1pc3NpbmdSZXF1aXJlZEF0dGVzdGF0aW9uAAAAAAAPAAAAJ0RlY2lzaW9uIGlzIGludmFsaWQgZm9yIHRoZSBjYXNlIHN0YXRlLgAAAAAPSW52YWxpZERlY2lzaW9uAAAAABAAAABHT2JzZXJ2YXRpb24gbGVkZ2VyIGlzIHplcm8gb3IgaW4gdGhlIGZ1dHVyZSByZWxhdGl2ZSB0byBjdXJyZW50IGxlZGdlci4AAAAADUludmFsaWRMZWRnZXIAAAAAAAARAAAANU9ic2VydmVyIHF1b3J1bSB0aHJlc2hvbGQgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIuAAAAAAAAFUludmFsaWRPYnNlcnZlclF1b3J1bQAAAAAAABIAAAAvUmVxdWlyZWQgb2JzZXJ2ZXIgcXVvcnVtIHRocmVzaG9sZCB3YXMgbm90IG1ldC4AAAAAFE9ic2VydmVyUXVvcnVtTm90TWV0AAAAEwAAAFVEaXNwdXRlIGhhcyBub3QgeWV0IGV4cGlyZWQ7IGN1cnJlbnQgbGVkZ2VyIHNlcXVlbmNlIGlzIGJlZm9yZSB0aGUgZXhwaXJhdGlvbiBsZWRnZXIuAAAAAAAAEURpc3B1dGVOb3RFeHBpcmVkAAAAAAAAFAAAAEtEaXNwdXRlIGhhcyBhbHJlYWR5IGV4cGlyZWQ7IHJlc29sdXRpb24gc3VibWlzc2lvbnMgYXJlIG5vIGxvbmdlciBhY2NlcHRlZC4AAAAAFURpc3B1dGVBbHJlYWR5RXhwaXJlZAAAAAAAABU=",
        "AAAABQAAAAAAAAAAAAAACkNhc2VCcm9rZW4AAAAAAAEAAAALY2FzZV9icm9rZW4AAAAAAwAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAEAAAAAAAAACG9ic2VydmVyAAAAEwAAAAAAAAAAAAAACmJyZWFrX2NvZGUAAAAAB9AAAAAJQnJlYWtDb2RlAAAAAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC0Nhc2VDcmVhdGVkAAAAAAEAAAAMY2FzZV9jcmVhdGVkAAAABAAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAAAAAADGNvdW50ZXJwYXJ0eQAAA+gAAAATAAAAAAAAAAAAAAARZXhwaXJlc19hdF9sZWRnZXIAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC0Nhc2VNYXRjaGVkAAAAAAEAAAAMY2FzZV9tYXRjaGVkAAAAAgAAAAAAAAAHY2FzZV9pZAAAAAPuAAAAIAAAAAEAAAAAAAAACG9ic2VydmVyAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADUNhc2VGaW5hbGl6ZWQAAAAAAAABAAAADmNhc2VfZmluYWxpemVkAAAAAAACAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAQAAAAAAAAATZmluYWxpemVkX2F0X2xlZGdlcgAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADUNhc2VRdW9ydW1TZXQAAAAAAAABAAAAD2Nhc2VfcXVvcnVtX3NldAAAAAACAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAQAAAAAAAAAGcXVvcnVtAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADURpc3B1dGVPcGVuZWQAAAAAAAABAAAADmRpc3B1dGVfb3BlbmVkAAAAAAADAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAQAAAAAAAAAJaW5pdGlhdG9yAAAAAAAAEwAAAAAAAAAAAAAAEmRpc3B1dGVfY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADU9ic2VydmVyQWRkZWQAAAAAAAABAAAADm9ic2VydmVyX2FkZGVkAAAAAAABAAAAAAAAAAhvYnNlcnZlcgAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADkRpc3B1dGVFeHBpcmVkAAAAAAABAAAAD2Rpc3B1dGVfZXhwaXJlZAAAAAADAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAQAAAAAAAAARZXhwaXJhdGlvbl9sZWRnZXIAAAAAAAAEAAAAAAAAAAAAAAAQY2xvc2VkX2F0X2xlZGdlcgAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD0Rpc3B1dGVSZXNvbHZlZAAAAAABAAAAEGRpc3B1dGVfcmVzb2x2ZWQAAAACAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAQAAAAAAAAAVcmVzb2x1dGlvbl9jb21taXRtZW50AAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAD09ic2VydmVyUmVtb3ZlZAAAAAABAAAAEG9ic2VydmVyX3JlbW92ZWQAAAABAAAAAAAAAAhvYnNlcnZlcgAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAE09ic2VydmF0aW9uUmVjb3JkZWQAAAAAAQAAABRvYnNlcnZhdGlvbl9yZWNvcmRlZAAAAAQAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAABAAAAAAAAAAhvYnNlcnZlcgAAABMAAAAAAAAAAAAAAAd0eF9oYXNoAAAAA+4AAAAgAAAAAAAAAAAAAAAPb2JzZXJ2ZWRfbGVkZ2VyAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAE1Jlc29sdXRpb25TdWJtaXR0ZWQAAAAAAQAAABRyZXNvbHV0aW9uX3N1Ym1pdHRlZAAAAAMAAAAAAAAAB2Nhc2VfaWQAAAAD7gAAACAAAAABAAAAAAAAAAhyZXNvbHZlcgAAABMAAAAAAAAAAAAAABVyZXNvbHV0aW9uX2NvbW1pdG1lbnQAAAAAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFEF0dGVzdGF0aW9uU3VibWl0dGVkAAAAAQAAABVhdHRlc3RhdGlvbl9zdWJtaXR0ZWQAAAAAAAADAAAAAAAAAAdjYXNlX2lkAAAAA+4AAAAgAAAAAQAAAAAAAAAIYXR0ZXN0b3IAAAATAAAAAAAAAAAAAAAEcm9sZQAAB9AAAAAPQXR0ZXN0YXRpb25Sb2xlAAAAAAAAAAAC",
        "AAAAAgAAAEVTdG9yYWdlIGtleSBkZWZpbml0aW9ucyBmb3IgaW5zdGFuY2UgYW5kIHBlcnNpc3RlbnQgY29udHJhY3Qgc3RvcmFnZS4AAAAAAAAAAAAAB0RhdGFLZXkAAAAACgAAAAAAAAApQWRtaW5pc3RyYXRvciBhZGRyZXNzIChpbnN0YW5jZSBzdG9yYWdlKS4AAAAAAAAFQWRtaW4AAAAAAAAAAAAALVByb3RvY29sIHZlcnNpb24gY29uc3RhbnQgKGluc3RhbmNlIHN0b3JhZ2UpLgAAAAAAAA9Db250cmFjdFZlcnNpb24AAAAAAQAAADZSZWdpc3RlcmVkIG9ic2VydmVyIGFkZHJlc3MgZmxhZyAocGVyc2lzdGVudCBzdG9yYWdlKS4AAAAAAAhPYnNlcnZlcgAAAAEAAAATAAAAAQAAAEdTZXR0bGVtZW50IGNhc2UgcmVjb3JkIGluZGV4ZWQgYnkgMzItYnl0ZSBjYXNlIElEIChwZXJzaXN0ZW50IHN0b3JhZ2UpLgAAAAAEQ2FzZQAAAAEAAAPuAAAAIAAAAAEAAABRUmVnaXN0ZXJlZCBvYnNlcnZlciB3aG8gcmVjb3JkZWQgdGhlIG9ic2VydmF0aW9uIGZvciBhIGNhc2UgKHBlcnNpc3RlbnQgc3RvcmFnZSkuAAAAAAAADENhc2VPYnNlcnZlcgAAAAEAAAPuAAAAIAAAAAEAAABJQXR0ZXN0YXRpb24gaW5kZXhlZCBieSBjYXNlIElEIGFuZCBhdHRlc3RvciBhZGRyZXNzIChwZXJzaXN0ZW50IHN0b3JhZ2UpLgAAAAAAAAtBdHRlc3RhdGlvbgAAAAACAAAD7gAAACAAAAATAAAAAQAAAFNSZXNvbHV0aW9uIGNvbW1pdG1lbnQgaW5kZXhlZCBieSBjYXNlIElEIGFuZCByZXNvbHZlciBhZGRyZXNzIChwZXJzaXN0ZW50IHN0b3JhZ2UpLgAAAAAKUmVzb2x1dGlvbgAAAAAAAgAAA+4AAAAgAAAAEwAAAAEAAABFQ29uZmlndXJlZCBvYnNlcnZlciBxdW9ydW0gdGhyZXNob2xkIGZvciBhIGNhc2UgKHBlcnNpc3RlbnQgc3RvcmFnZSkuAAAAAAAACkNhc2VRdW9ydW0AAAAAAAEAAAPuAAAAIAAAAAEAAABgTGlzdCBvZiBkaXN0aW5jdCBvYnNlcnZlciBhZGRyZXNzZXMgdGhhdCBzdWJtaXR0ZWQgYXR0ZXN0YXRpb25zIGZvciBhIGNhc2UgKHBlcnNpc3RlbnQgc3RvcmFnZSkuAAAAFUNhc2VBdHRlc3RlZE9ic2VydmVycwAAAAAAAAEAAAPuAAAAIAAAAAEAAABLRGlzcHV0ZSBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBpbmRleGVkIGJ5IGNhc2UgSUQgKHBlcnNpc3RlbnQgc3RvcmFnZSkuAAAAABFEaXNwdXRlRXhwaXJhdGlvbgAAAAAAAAEAAAPuAAAAIA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_case: this.txFromJSON<Result<SettlementCase>>,
        create_case: this.txFromJSON<Result<void>>,
        is_observer: this.txFromJSON<boolean>,
        add_observer: this.txFromJSON<Result<void>>,
        open_dispute: this.txFromJSON<Result<void>>,
        record_break: this.txFromJSON<Result<void>>,
        record_match: this.txFromJSON<Result<void>>,
        finalize_case: this.txFromJSON<Result<void>>,
        expire_dispute: this.txFromJSON<Result<void>>,
        get_resolution: this.txFromJSON<Option<Buffer>>,
        get_attestation: this.txFromJSON<Option<Attestation>>,
        get_case_quorum: this.txFromJSON<u32>,
        remove_observer: this.txFromJSON<Result<void>>,
        set_case_quorum: this.txFromJSON<Result<void>>,
        submit_resolution: this.txFromJSON<Result<void>>,
        record_observation: this.txFromJSON<Result<void>>,
        submit_attestation: this.txFromJSON<Result<void>>,
        open_dispute_with_ttl: this.txFromJSON<Result<void>>,
        get_attested_observers: this.txFromJSON<Array<string>>,
        get_dispute_expiration: this.txFromJSON<Option<u32>>,
        submit_observer_attestation: this.txFromJSON<Result<void>>
  }
}