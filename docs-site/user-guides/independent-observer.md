# Independent Observer User Guide

The **Independent Observer** is a trusted third-party verifier, oracle node, or institutional auditor registered on the `SettlementRegistry` smart contract.

## Persona Responsibilities
- Continuously monitors the Stellar ledger for incoming payment transactions.
- Ingests and anchors transaction observations (`record_observation`).
- Triggers the deterministic matcher engine and records on-chain reconciliation decisions (`record_match` or `record_break`).
- Signs independent witness attestations (`OBSERVER`).

---

## Step-by-Step Workflow

### 1. Register Observer Key On-Chain

Observers must be authorized by the `SettlementRegistry` contract admin:

```bash
stellar contract invoke \
  --id CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5 \
  --source <ADMIN_SECRET> \
  --network testnet \
  -- add_observer \
  --observer GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

---

### 2. Ingest Payment Observation

When the observer node detects a matching Stellar transfer for an open case, it submits the observation details:

```bash
curl -X POST http://localhost:3000/v1/cases/1212121212121212121212121212121212121212121212121212121212121212/observe \
  -H "Content-Type: application/json" \
  -d '{
    "observed": {
      "caseId": "1212121212121212121212121212121212121212121212121212121212121212",
      "txHash": "3434343434343434343434343434343434343434343434343434343434343434",
      "ledger": 1995000,
      "amount": "1000.0000000",
      "asset": "EURC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "destination": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      "reference": "INV-2026-001",
      "status": "SUCCESS"
    }
  }'
```

**Expected Outcome**: Case state transitions from `OPEN` to `OBSERVED`.

---

### 3. Trigger Deterministic Reconciliation

Execute the deterministic matcher to compare expected and observed parameters:

```bash
curl -X POST http://localhost:3000/v1/cases/1212121212121212121212121212121212121212121212121212121212121212/reconcile
```

**Outcomes**:
- **Clean Match**: Decision recorded as `MATCHED`. Status transitions to `MATCHED`.
- **Variance Detected**: Decision recorded as `BREAK` with specific `BreakCode`. Status transitions to `BREAK`.

---

### 4. Submit Witness Attestation

The observer submits a witness attestation affirming the observation and reconciliation result:

```bash
curl -X POST http://localhost:3000/v1/cases/1212121212121212121212121212121212121212121212121212121212121212/attestations \
  -H "Content-Type: application/json" \
  -d '{
    "role": "OBSERVER",
    "signer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "signature": "304502210044abcdef..."
  }'
```
