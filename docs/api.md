# StellarClear REST API Reference

The StellarClear API service provides endpoints to manage the end-to-end settlement reconciliation, attestation, dispute, and proof lifecycle.

**Base Path**: `/`  
**Content-Type**: `application/json`  
**Network Header**: Standard tracing header `X-Request-Id` is accepted and returned on all responses.

---

## Endpoints Summary

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/health` | Service health status |
| `GET` | `/ready` | Service readiness and database connectivity |
| `GET` | `/v1/operations/diagnostics` | Deep settlement pipeline health, DB latency, contract RPC reachability, and ledger indexing status |
| `GET` | `/v1/version` | Authoritative protocol version, pinned SettlementRegistry release metadata, and compatibility status |
| `POST` | `/v1/cases` | Create a new settlement case and anchor on Soroban |
| `GET` | `/v1/cases/:caseId` | Retrieve a settlement case by 32-byte hex ID |
| `GET` | `/v1/cases/:caseId/onchain` | Query authoritative on-chain contract state |
| `GET` | `/v1/cases/:caseId/history` | Query on-chain historical transaction hashes |
| `GET` | `/v1/cases/:caseId/consistency` | Verify consistency between off-chain database and Soroban state |
| `GET` | `/v1/cases/:caseId/audit` | Retrieve complete audit trail and milestone events |
| `POST` | `/v1/cases/:caseId/observe` | Record an observed Stellar settlement transaction |
| `POST` | `/v1/cases/:caseId/reconcile` | Run automated reconciliation matcher and anchor decision |
| `GET` | `/v1/cases/:caseId/breaks` | List reconciliation break diagnostics |
| `POST` | `/v1/cases/:caseId/attest` | Submit a cryptographic settlement attestation |
| `GET` | `/v1/cases/:caseId/attestations` | List all recorded attestations for a case |
| `GET` | `/v1/cases/:caseId/quorum` | Check required and submitted observer quorum verification status |
| `POST` | `/v1/cases/:caseId/dispute` | Open a settlement dispute with evidence payload (BREAK status only) |
| `POST` | `/v1/cases/:caseId/resolve` | Submit a dispute resolution agreement (requires mutual agreement) |
| `GET` | `/v1/cases/:caseId/dispute` | Get durable dispute and resolution evidence for a case |
| `POST` | `/v1/cases/:caseId/finalize` | Finalize a matched or resolved case on Soroban (enforces quorum) |
| `GET` | `/v1/cases/:caseId/proof` | Export a verifiable `SettlementProof` artifact |
| `POST` | `/v1/proofs/verify` | Offline cryptographic proof verification |
| `POST` | `/v1/proofs/verify/onchain` | Verify cryptographic proof against live Soroban contract state |

---

## 1. Case Management

### `POST /v1/cases`
Creates a new expected settlement instruction, computes its terms commitment, anchors the case on Soroban, and stores it in the database.

**Request Body**:
```json
{
  "expected": {
    "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
    "owner": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    "counterparty": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "tradeReference": "TRADE-100",
    "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "amount": "50000.00",
    "expectedDestination": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    "reference": "INV-999",
    "deadline": 1250000
  }
}
```

**Response (201 Created)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "status": "OPEN",
  "termsCommitment": "a3b1c2...",
  "txHash": "0x_create_tx_...",
  "createdAt": "2026-09-29T14:00:00.000Z"
}
```

---

## 2. Observation & Reconciliation

### `POST /v1/cases/:caseId/observe`
Records an observed Stellar payment transaction.

**Request Body**:
```json
{
  "observation": {
    "txHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ledger": 1249950,
    "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "amount": "50000.00",
    "destination": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    "reference": "INV-999",
    "status": "SUCCESS",
    "observedAt": "2026-09-29T14:05:00.000Z"
  }
}
```

**Response (200 OK)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "status": "OBSERVED",
  "observationCommitment": "f4e5d6...",
  "txHash": "0x_obs_tx_...",
  "observedAt": "2026-09-29T14:05:00.000Z"
}
```

### `POST /v1/cases/:caseId/reconcile`
Executes automated rule matching against expected terms and observed transaction.

**Response (200 OK - Match)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "status": "MATCHED",
  "matched": true,
  "breaks": [],
  "reconciledAt": "2026-09-29T14:06:00.000Z",
  "txHash": "0x_match_tx_..."
}
```

---

## 3. Observer Quorum & Attestations

### `GET /v1/cases/:caseId/quorum`
Inspects the observer quorum requirements and current verification status for a settlement case.

**Response (200 OK - Quorum Met)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "requiredQuorum": 3,
  "distinctObserverCount": 3,
  "quorumSatisfied": true,
  "eligibleForFinalization": true,
  "distinctObservers": [
    "GAOBSERVER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "GAOBSERVER2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "GAOBSERVER3CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
  ]
}
```

**Response (200 OK - Quorum Not Met)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "requiredQuorum": 3,
  "distinctObserverCount": 2,
  "quorumSatisfied": false,
  "eligibleForFinalization": false,
  "distinctObservers": [
    "GAOBSERVER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "GAOBSERVER2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
  ]
}
```

---

## 4. Disputes & Mutual Resolution

### `POST /v1/cases/:caseId/dispute`
Opens a dispute on a settlement case. **Strictly guarded: Can only be called when the authoritative case status is `BREAK`**. Any attempt to open a dispute from `OPEN`, `OBSERVED`, or `MATCHED` is rejected with `400 Bad Request`.

**Request Body**:
```json
{
  "initiator": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
  "reason": "Amount received was less than agreed trade contract",
  "evidence": {
    "bankStatementRef": "STMT-2026-09",
    "notes": "Missing 50 USDC in net settlement"
  },
  "disputeTtlLedgers": 1000
}
```

**Response (201 Created)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "status": "DISPUTED",
  "initiator": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
  "reason": "Amount received was less than agreed trade contract",
  "disputeCommitment": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "txHash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "disputedAt": "2026-09-29T14:15:00.000Z",
  "disputeExpiresAtLedger": 1251000
}
```

### `POST /v1/cases/:caseId/resolve`
Submits an agreed resolution commitment. **Enforces mutual resolution**:
- **First Submission**: Case remains in `DISPUTED` state (`mutualResolutionAchieved: false`). The resolver and commitment are durably recorded in PostgreSQL.
- **Second Submission (Matching)**: On-chain transaction succeeds, case transitions to `RESOLVED` (`mutualResolutionAchieved: true`).
- **Second Submission (Mismatch)**: Case remains in `DISPUTED` state; error indicates commitment mismatch.

**Request Body**:
```json
{
  "resolver": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
  "resolutionType": "PARTIAL_REFUND",
  "notes": "Agreed to credit 50 USDC discrepancy on next trade batch",
  "resolutionCommitment": "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5"
}
```

**Response (200 OK - First Submission, Remains DISPUTED)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "status": "DISPUTED",
  "resolver": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
  "resolutionType": "PARTIAL_REFUND",
  "resolutionCommitment": "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
  "mutualResolutionAchieved": false,
  "txHash": "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "resolvedAt": "2026-09-29T14:30:00.000Z"
}
```

**Response (200 OK - Second Submission, Matches & Becomes RESOLVED)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "status": "RESOLVED",
  "resolver": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "resolutionType": "PARTIAL_REFUND",
  "resolutionCommitment": "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
  "mutualResolutionAchieved": true,
  "txHash": "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
  "resolvedAt": "2026-09-29T14:35:00.000Z"
}
```

### `GET /v1/cases/:caseId/dispute`
Retrieves durable dispute and resolution records from PostgreSQL. Survives service restarts.

**Response (200 OK)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "disputeState": "RESOLVED",
  "disputeCommitment": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "resolutionCommitmentsObserved": 2,
  "mutualResolutionAchieved": true,
  "expiryLedger": 1251000,
  "expirationState": "ACTIVE",
  "expiredAtLedger": null,
  "disputes": [
    {
      "id": "disp_1111111111111111111111111111111111111111111111111111111111111111",
      "initiator": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      "reason": "Amount received was less than agreed trade contract",
      "disputeCommitment": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "txHash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "createdAt": "2026-09-29T14:15:00.000Z"
    }
  ],
  "resolutions": [
    {
      "id": "res_1111111111111111111111111111111111111111111111111111111111111111_0",
      "resolver": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      "resolutionType": "PARTIAL_REFUND",
      "resolutionCommitment": "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
      "txHash": "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "createdAt": "2026-09-29T14:30:00.000Z"
    },
    {
      "id": "res_1111111111111111111111111111111111111111111111111111111111111111_1",
      "resolver": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "resolutionType": "PARTIAL_REFUND",
      "resolutionCommitment": "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
      "txHash": "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
      "createdAt": "2026-09-29T14:35:00.000Z"
    }
  ]
}
```

---

## 5. Case Finalization

### `POST /v1/cases/:caseId/finalize`
Finalizes a `MATCHED` or `RESOLVED` case on Soroban. **Enforces observer quorum**:
- Requires `distinctObserverCount >= requiredObserverQuorum`.
- If quorum is not met, returns `409 Conflict` with `code: "QUORUM_NOT_MET"`.

**Response (200 OK - Successful Finalization)**:
```json
{
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "status": "FINALIZED",
  "finalizedLedger": 1250100,
  "txHash": "0x_finalize_tx_...",
  "finalizedAt": "2026-09-29T14:40:00.000Z"
}
```

**Error Response (409 Conflict - Quorum Not Met)**:
```json
{
  "error": {
    "code": "QUORUM_NOT_MET",
    "message": "Cannot finalize case: observer quorum not satisfied",
    "details": {
      "requiredQuorum": 3,
      "distinctObserverCount": 2,
      "quorumSatisfied": false
    }
  }
}
```

---

## 6. Proof Verification

### `POST /v1/proofs/verify/onchain`
Verifies a `SettlementProof` package against canonical commitments and queries live Soroban smart contract state.

**Request Body**:
```json
{
  "proof": {
    "version": "1.0.0",
    "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
    "termsCommitment": "a3b1c2...",
    "observationCommitment": "f4e5d6...",
    "finalizedLedger": 1250000,
    "result": "MATCHED",
    "attestations": [],
    "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    "network": "testnet",
    "generatedAt": "2026-09-29T14:10:00.000Z"
  },
  "termsDocument": { ... },
  "observedDocument": { ... }
}
```

**Response (200 OK)**:
```json
{
  "valid": true,
  "recomputedTermsCommitment": "a3b1c2...",
  "recomputedObservationCommitment": "f4e5d6...",
  "onChainState": {
    "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
    "status": "MATCHED",
    "termsCommitment": "a3b1c2...",
    "observationCommitment": "f4e5d6...",
    "finalizedLedger": 1250000
  },
  "verifiedAt": "2026-09-29T14:12:00.000Z"
}
```

---

## Error Handling Model

All error responses adhere to the standard envelope format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid decimal format in amount",
    "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "details": [ ... ]
  }
}
```

### Standard HTTP Status Codes:
- `400 Bad Request`: Payload validation error or invalid lifecycle transition (e.g. attempting to open dispute on non-BREAK case).
- `403 Forbidden`: Unauthorized participant action for role.
- `404 Not Found`: Target case ID does not exist.
- `409 Conflict`: Duplicate case ID creation (`CONFLICT`), or observer quorum not met on finalization (`QUORUM_NOT_MET`).
- `500 Internal Server Error`: Unhandled server or RPC exception.

