# Error Codes Reference

This document indexes all error codes across the REST API and the Soroban `SettlementRegistry` smart contract.

## Soroban Contract Error Discriminants

The `SettlementRegistry` contract defines stable numeric error codes returned on transaction failure:

| Code | Error Name | Description |
| :--- | :--- | :--- |
| **`1`** | `AlreadyInitialized` | Contract constructor has already been executed. |
| **`2`** | `NotFound` | Requested settlement case or attestation was not found. |
| **`3`** | `CaseAlreadyExists` | Case with the given 32-byte identifier already exists. |
| **`4`** | `ObserverAlreadyRegistered` | Observer address is already registered in the whitelist. |
| **`5`** | `ObserverNotRegistered` | Caller is not an authorized registered observer. |
| **`6`** | `Unauthorized` | Caller lacks required authorization for the requested operation. |
| **`7`** | `InvalidState` | Target case is not in a valid lifecycle state for the operation. |
| **`8`** | `InvalidExpiration` | Expiration sequence must be strictly greater than current ledger. |
| **`9`** | `InvalidCommitment` | Commitment payload is malformed or all zeros. |
| **`10`** | `CounterpartyRequired` | Operation requires a counterparty address, but none was defined. |
| **`11`** | `CounterpartyNotAllowed` | Counterparty cannot be the same address as the case owner. |
| **`12`** | `AttestationAlreadyExists` | Attestation already submitted by this address for the case. |
| **`13`** | `ResolutionAlreadySubmitted` | Resolution commitment already submitted by this party. |
| **`14`** | `ResolutionMismatch` | Bilateral resolution commitments between parties do not match. |
| **`15`** | `MissingRequiredAttestation` | Required participant attestation is missing. |
| **`16`** | `InvalidDecision` | Decision tag is invalid for the current case state. |
| **`17`** | `InvalidLedger` | Observation ledger is zero or in the future relative to current ledger. |
| **`18`** | `InvalidObserverQuorum` | Observer quorum threshold must be a positive integer. |
| **`19`** | `ObserverQuorumNotMet` | Required observer quorum threshold was not met. |
| **`20`** | `DisputeNotExpired` | Dispute has not yet expired; current ledger sequence is before expiration ledger. |
| **`21`** | `DisputeAlreadyExpired` | Dispute has already expired; resolution submissions are no longer accepted. |

---

## REST API Error Envelopes

API errors are returned in a standardized, sanitized JSON envelope:

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Cannot finalize case in OPEN state",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

| HTTP Status | Error Code | Description |
| :--- | :--- | :--- |
| **`400`** | `VALIDATION_ERROR` | Request payload failed Zod schema validation or amount was non-numeric. |
| **`400`** | `INVALID_STATE_TRANSITION` | Operation attempted an invalid lifecycle state progression. |
| **`401`** | `UNAUTHORIZED` | Request missing valid authorization credentials. |
| **`403`** | `FORBIDDEN` | Signer is not authorized to submit attestations or execute action for case. |
| **`404`** | `NOT_FOUND` | Case ID, attestation, or proof record does not exist. |
| **`409`** | `CONFLICT` | Resource conflict or duplicate case identifier. |
| **`409`** | `QUORUM_NOT_MET` | Cannot finalize case because required distinct observer quorum has not been met. |
| **`409`** | `IDEMPOTENCY_CONFLICT` | Reused idempotency key with conflicting payload. |
| **`500`** | `INTERNAL_ERROR` | Internal server or storage exception (sanitized in production). |
| **`503`** | `NOT_READY` | Readiness probe failed due to database or Soroban RPC unavailability. |
