# Protocol Roadmap & Release Scope

This page outlines the deployed `v0.1.0` capabilities alongside planned post-v0.1.0 roadmap items.

## Current Deployed Scope (`v0.1.0`)

The current release is deployed and active on the **Stellar Testnet**:
- **Contract ID (Hardened Release v0.1.1)**: `CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5` *(Historical prototype: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`)*
- **Implemented Features**:
  - Deterministic 7-state settlement lifecycle state machine on Soroban.
  - Standardized 9-category reconciliation break taxonomy.
  - Canonical JSON serialization (`RFC 8785`) & SHA-256 commitments.
  - Portable, self-contained `SettlementProof` bundle generation and offline verification.
  - 21 REST API endpoints for case management, attestations, disputes, and operational health probes.
  - PostgreSQL persistence with strict idempotency and dispute evidence persistence.
  - Standalone streaming indexer service with failure-safe cursor checkpoints.
  - Real-time WebSocket event streaming (`ws://localhost:3001/v1/events/stream`) with bounded in-memory replay.
  - Multi-oracle observer quorum verification (`M-of-N`) in SDK, API, and Soroban finalization.
  - Guarded dispute opening (`BREAK` status only) and mutual resolution agreement requirements.
  - On-chain dispute expiration TTL handling and indexer resynchronization.
  - Production-grade multi-stage Dockerfile and Docker Compose topology (`postgres`, `indexer`, `api`).

---

## Roadmap Milestones & Status

The following features represent roadmap items tracked on GitHub:

| Issue | Area | Title | Status | Scope |
| :--- | :--- | :--- | :--- | :--- |
| **#2** | Indexer | `feat(indexer): add real-time websocket event subscription stream` | **Completed (v0.1.0)** | Enables client applications to subscribe to streaming settlement transitions. |
| **#3** | CI / Testing | `test(e2e): automate multi-party attestation flow against testnet` | **Completed (v0.1.0)** | End-to-end multi-party settlement, observer quorum, dispute resolution, and TTL expiration tests. |
| **#16** | SDK & API | `feat(sdk,api): add observer quorum verification and threshold attestation support` | **Completed (v0.1.0)** | Multi-oracle quorum validation (`M-of-N`) across SDK, API, and Soroban finalization. |
| **#17** | Indexer | `feat(indexer): handle on-chain dispute expiration TTL events and state progression` | **Completed (v0.1.0)** | Automated off-chain state updates and DB transitions when dispute TTL expires. |
| **#18** | API / Ops | `feat(api): expose Prometheus-compatible metrics endpoint for operational telemetry` | Scheduled (v0.2.0) | Prometheus exposition format (`/metrics`) for Grafana scrapers. |
| **#19** | Indexer | `feat(indexer): add exponential backoff and jitter for resilient RPC error recovery` | Scheduled (v0.2.0) | Adaptive backoff during RPC rate limits and transient network partitions. |
