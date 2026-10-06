# StellarClear Operations & Monitoring Guide

This guide specifies operational baselines, telemetry, health/readiness probes, database maintenance, consistency diagnostics, recovery playbooks, and incident response procedures for operating StellarClear v0.1.0 in production and testnet environments.

---

## 1. Operational Probes & Service Health Monitoring

StellarClear exposes three tiers of monitoring endpoints designed for container orchestrators (Kubernetes), load balancers, and observability agents (Prometheus/Grafana/Datadog):

### Liveness Probe (`GET /health`)
Verifies that the Node.js API process event loop is active and serving traffic.

```bash
curl -i http://localhost:3000/health
```

**Response (HTTP 200 OK):**
```json
{
  "status": "ok",
  "service": "stellarclear-api",
  "version": "0.1.0",
  "uptimeSeconds": 86400,
  "timestamp": "2026-10-01T12:00:00.000Z"
}
```

### Readiness Probe (`GET /ready`)
Performs active ping checks against downstream dependencies:
- **Database**: Executes `SELECT 1;`
- **Soroban RPC**: Validates network passphrase and RPC connectivity
- **SettlementRegistry Contract**: Validates contract ID StrKey format and network compatibility
- **Indexer**: Verifies sync cursor availability

```bash
curl -i http://localhost:3000/ready
```

**Response (HTTP 200 OK):**
```json
{
  "status": "ready",
  "timestamp": "2026-10-01T12:00:00.000Z",
  "version": "0.1.0",
  "network": "testnet",
  "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
  "services": {
    "database": { "status": "up", "details": { "driver": "postgresql/in-memory" } },
    "sorobanRpc": { "status": "up", "details": { "network": "testnet", "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5" } },
    "settlementRegistry": { "status": "up", "details": { "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5", "validFormat": true } },
    "indexer": { "status": "up", "details": { "synced": true, "network": "testnet" } }
  }
}
```
*Returns `HTTP 503 Service Unavailable` with `status: "not_ready"` if any core dependency fails.*

---

## 2. Structured Settlement Health Diagnostics

For deep operational telemetry, query `GET /v1/operations/diagnostics`:

```bash
curl -s http://localhost:3000/v1/operations/diagnostics | jq
```

```json
{
  "status": "healthy",
  "timestamp": "2026-10-01T12:00:00.000Z",
  "uptimeSeconds": 86400,
  "version": "0.1.0",
  "environment": "testnet",
  "release": {
    "protocol": "STELLARCLEAR",
    "version": "0.1.0",
    "releaseTag": "v0.1.0",
    "contract": {
      "name": "settlement_registry",
      "version": "0.1.0",
      "releaseTag": "v0.1.0",
      "wasmHash": "1018a81b1ac95046cb00466ceda7ee347204c08b71b1c51b3c9611dd32215d66",
      "specVersion": 1,
      "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
      "network": "testnet",
      "compatible": true
    },
    "features": [
      "case_creation",
      "observation_anchoring",
      "match_reconciliation",
      "break_classification",
      "dispute_workflows",
      "arbitration_resolution",
      "multi_party_attestations",
      "onchain_finalization"
    ]
  },
  "database": {
    "status": "healthy",
    "latencyMs": 3,
    "totalCases": 1250,
    "totalObservations": 1248,
    "totalReconciliations": 1248,
    "totalBreaks": 14
  },
  "contract": {
    "status": "healthy",
    "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
    "network": "testnet",
    "rpcUrl": "https://soroban-testnet.stellar.org",
    "anchoringEnabled": true,
    "rpcLatencyMs": 42
  },
  "indexing": {
    "status": "synced",
    "latestLedger": 1650420,
    "indexedCheckpoint": 1650420,
    "pendingEventsCount": 0
  },
  "pipeline": {
    "openCases": 2,
    "matchedCases": 1234,
    "brokenCases": 14,
    "disputedCases": 4,
    "resolvedCases": 4,
    "finalizedCases": 1230
  }
}
```

---

## 3. Indexer Progression, Failure-Safe Checkpoints & Event Ingestion

The Indexer service continuously streams Soroban contract events with guaranteed failure-safe ordering:

### Failure-Safe Cursor Atomicity
- **Persistence**: Saved in PostgreSQL table `ingestion_cursors` (`network`, `last_processed_ledger`, `last_processed_event_cursor`).
- **Processing Invariant**: "If event *N* fails to process durably, the cursor **never** advances beyond event *N - 1*." The indexer immediately halts the batch and logs an error, ensuring that restarting the service retries event *N* instead of silently skipping it.
- **Idempotency**: All event handlers utilize idempotent UPSERTs (`ON CONFLICT DO NOTHING` / version checks). Replaying previously processed events produces deterministic database state.

### Checkpoint Ingestion Flow
```
Soroban RPC (getEvents) ──► EventDecoder ──► Failure-Safe Pipeline ──► State Sync ──► Durable Cursor Commit
                                                      │
                                                      └──► Real-Time Stream Broadcast
```

### Dispute Expiration & Event Ingestion
- When `DisputeExpired` events arrive, the indexer decodes the event payload (`case_id`, `expired_at_ledger`), inserts a record into `dispute_expirations`, updates `settlement_cases` status to `BREAK`, and clears stale resolution attempts.
- The indexer processes events idempotently and emits structured operational logs.

---

## 4. Real-Time WebSocket Settlement Event Stream

StellarClear includes a high-performance WebSocket event stream server embedded in the Indexer service, enabling downstream consumers and dashboards to receive verified settlement state transitions in real time without polling.

### Configuration
| Environment Variable | Description | Default |
|:---|:---|:---|
| `INDEXER_STREAM_PORT` | Port for the WebSocket server | `3001` |
| `INDEXER_STREAM_PATH` | Path for WebSocket endpoint | `/v1/events/stream` |
| `INDEXER_STREAM_BUFFER_SIZE` | Bounded in-memory replay buffer capacity | `1000` |

### Connection & Subscription Protocol
Connect via WebSocket to `ws://localhost:3001/v1/events/stream`.

**1. Subscribe to All Events**:
```json
{
  "action": "subscribe"
}
```

**2. Filtered Subscription with Replay Cursor**:
```json
{
  "action": "subscribe",
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "cursor": "0000000001650420-0000000001"
}
```

### Event Payload Format
All streamed events adhere to a standard envelope:
```json
{
  "eventId": "evt_1650420_1",
  "network": "testnet",
  "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
  "ledger": 1650420,
  "cursor": "0000000001650420-0000000001",
  "timestamp": "2026-10-01T12:00:00.000Z",
  "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
  "eventType": "CaseDisputed",
  "data": {
    "caseId": "1111111111111111111111111111111111111111111111111111111111111111",
    "initiator": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    "disputeCommitment": "e3b0c442..."
  }
}
```

### Transient Disconnects & Replay Guarantee
- **In-Memory Replay Buffer**: Holds up to `1000` recent events. If a client disconnects and reconnects with a recent `cursor`, missed events are replayed immediately from memory in strict chronological order.
- **Durable Historical Replay**: For deeper disconnections beyond buffer capacity, events are safely replayed from the PostgreSQL database using standard indexer cursor queries.

---

## 5. Cross-Layer Consistency Diagnostics

To detect state drift between database, indexer, contract, and settlement proofs:

```bash
curl http://localhost:3000/v1/cases/:caseId/consistency
```

### Consistency Classifications:
| Classification | Description | Automatic Remediation |
| :--- | :--- | :--- |
| `CONSISTENT` | 100% agreement between off-chain DB, Soroban contract, and cryptographic proof. | None required. |
| `MISSING_ONCHAIN_CASE` | Case exists in DB but not on-chain (e.g. failed RPC submission). | Re-submit `anchorCaseCreation` or retry creation. |
| `COMMITMENT_MISMATCH` | Terms or observation hash differs between DB and Soroban. | Investigate payload mutation; verify domain canonicalization. |
| `STATE_MISMATCH` | Database status conflicts with on-chain status. | Check indexer sync status; trigger state resynchronization. |
| `STALE_DATABASE` | Soroban state advanced beyond database representation. | Allow indexer catch-up or force replay from checkpoint ledger. |
| `STALE_CHAIN_REFERENCE` | Finalized record in DB lacks `finalization_tx_hash`. | Indexer syncs missing transaction reference on event arrival. |

---

## 6. Database Maintenance & Growth Considerations

### Sizing & Indexing Baseline
- `settlement_cases`: Primary key on `id` (64-byte hex); composite unique constraint `(network, id)`.
- `settlement_observations`: Foreign key `case_id`; unique constraint `(network, case_id, tx_hash)`.
- `settlement_disputes`: Foreign key `case_id`; records dispute initiators and evidence hashes.
- `settlement_resolutions`: Foreign key `case_id`; records bilateral resolvers and resolution commitments.
- `dispute_expirations`: Records ledger sequence and timestamps of dispute expirations.
- `contract_events`: Append-only event store; indexed by `(network, cursor)` and `(network, ledger)`.

### Routine Maintenance
```sql
-- Analyze table query plans
VACUUM ANALYZE settlement_cases;
VACUUM ANALYZE settlement_observations;
VACUUM ANALYZE settlement_disputes;
VACUUM ANALYZE settlement_resolutions;
VACUUM ANALYZE contract_events;

-- Reindex high-cardinality tables monthly
REINDEX TABLE CONCURRENTLY settlement_cases;
```

---

## 7. Incident Response & Recovery Playbooks

### Playbook A: Stalled Indexer Ingestion
1. Check indexer diagnostic status: `GET /v1/operations/diagnostics` -> `indexing.status`.
2. Inspect last recorded cursor:
   ```sql
   SELECT * FROM ingestion_cursors WHERE network = 'testnet';
   ```
3. Restart indexer with safe replay offset:
   ```bash
   START_LEDGER=1500000 npm run start --workspace=@stellarclear/indexer
   ```

### Playbook B: Soroban RPC Outage / Rate-Limiting
1. `GET /ready` returns `503 Service Unavailable` (`sorobanRpc: down`).
2. Verify RPC endpoint health:
   ```bash
   curl -X POST https://soroban-testnet.stellar.org -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```
3. Failover to backup RPC endpoint by updating `STELLAR_RPC_URL` in `.env` and reloading the service.

### Playbook C: Stale Chain References Detected
1. Run consistency check on affected case ID: `GET /v1/cases/:caseId/consistency`.
2. Query audit trail: `GET /v1/cases/:caseId/audit`.
3. Ingest missing ledger events or trigger sync via indexer.

---

## 8. Current v0.1.0 Scope & Roadmap

1. **Bilateral Mutual Resolution**: Implemented. Resolving a dispute requires both owner and counterparty to submit matching resolution commitments.
2. **Dispute TTL & Expiration**: Implemented. If resolution is not achieved before TTL, disputes expire back to `BREAK`.
3. **Observer Quorum (M-of-N)**: Implemented. Multi-party cases require distinct authorized observer attestations meeting quorum before finalization.
4. **Real-Time WebSocket Streaming**: Implemented. Indexer provides `ws://localhost:3001/v1/events/stream` with bounded in-memory replay.
5. **Storage Retention**: Off-chain audit history is retained indefinitely; database partitioning by month is recommended for >10M settlement cases.

