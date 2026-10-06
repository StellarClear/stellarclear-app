# StellarClear — Drips Stellar Wave Submission Package

This document contains the authoritative submission package and verified technical metadata for **StellarClear** in the Drips Stellar Wave Program.

---

## 1. Project Description

Cross-border and institutional payment settlement frequently suffers from asymmetric records, manual reconciliation latency, and expensive dispute resolution when counterparties observe divergent payment states. StellarClear resolves this friction by providing a non-custodial, deterministic settlement evidence and reconciliation protocol built natively on Stellar and Soroban. Off-chain, StellarClear computes canonical SHA-256 cryptographic commitments over agreed trade terms and compares them against observed ledger payment executions to automatically categorize settlement outcomes and diagnose discrepancies. On-chain, the Soroban `SettlementRegistry` contract serves as an immutable anchor—recording observer-signed evidence, multi-party cryptographic attestations, dispute transitions, and irreversible settlement finalizations without ever taking custody of participant funds. Fully implemented, packaged, and verified, the protocol is deployed on Stellar Testnet (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`), backed by comprehensive security regression suites, automated cross-layer consistency verification, and a live public documentation site.

---

## 2. Technical Repository Relationship

The StellarClear protocol strictly separates trustless on-chain state anchoring from off-chain settlement ingestion and business logic across two dedicated repositories:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      STELLAR CLEAR PROTOCOL ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────────────────┘

       OFF-CHAIN REPOSITORY                          ON-CHAIN REPOSITORY
  StellarClear/stellarclear-app                StellarClear/stellarclear-contract
┌────────────────────────────────┐            ┌────────────────────────────────┐
│  REST API (services/api)       │            │  SettlementRegistry Contract   │
│  - Idempotent case creation    │            │  - Authoritative State Anchor  │
│  - Proof generation & verify   │            │  - Observer Registry Whitelist │
├────────────────────────────────┤            │  - Cryptographic Commitments   │
│  Matcher (packages/matcher)    │            │  - Dispute State Transitions   │
│  - Deterministic reconciliation│            │  - Multi-Party Attestations    │
│  - Standardized Break Taxonomy │            │  - Typed Soroban Events        │
├────────────────────────────────┤            └────────────────────────────────┘
│  Streaming Indexer             │                             ▲
│  - Event stream checkpointing  │                             │
│  - Relational SQL sync         │ ◄── Soroban RPC Events ─────┤
├────────────────────────────────┤                             │
│  Client SDK (packages/sdk)     │ ─── Contract Invocations ───┘
│  - Auto-generated bindings     │
│  - Error normalization         │
└────────────────────────────────┘
```

1. **[`StellarClear/stellarclear-contract`](https://github.com/StellarClear/stellarclear-contract)** hosts the authoritative Soroban smart contract (`SettlementRegistry`). Written in Rust, it provides immutable state storage, cryptographic commitment validation, observer authorization whitelisting, multi-party attestation tracking, dispute resolution transitions, and event emission. The contract never custodies funds; it acts as an incorruptible referee anchoring settlement lifecycle milestones.
2. **[`StellarClear/stellarclear-app`](https://github.com/StellarClear/stellarclear-app)** hosts the off-chain TypeScript monorepo providing the high-throughput operational infrastructure:
   - `packages/sdk`: Typed contract client generated directly from Soroban contract specs, providing error normalization and attestation helpers.
   - `packages/proof`: Canonical deterministic JSON hashing library computing collision-resistant SHA-256 commitments for trade terms and observation records.
   - `packages/matcher`: Deterministic arithmetic reconciliation engine identifying clean matches or categorizing reconciliation breaks (`AMOUNT_MISMATCH`, `DESTINATION_MISMATCH`, `LATE_SETTLEMENT`, etc.).
   - `services/indexer`: Resilient event streamer ingesting Soroban contract events from the RPC endpoint and maintaining an indexed relational PostgreSQL view.
   - `services/api`: Enterprise Fastify REST API providing idempotent case management, dispute workflows, cryptographic proof validation, and operational health diagnostics.

---

## 3. Verified Repositories & Deployment Metadata

| Field | Value / Verified Link |
| :--- | :--- |
| **Application Repository** | [`https://github.com/StellarClear/stellarclear-app`](https://github.com/StellarClear/stellarclear-app) |
| **Smart Contract Repository** | [`https://github.com/StellarClear/stellarclear-contract`](https://github.com/StellarClear/stellarclear-contract) |
| **Live Documentation URL** | [`https://stellarclear.github.io/stellarclear-app/`](https://stellarclear.github.io/stellarclear-app/) |
| **Live Application / Runtime Topology** | Monorepo multi-container runtime (`services/api`, `services/indexer`, `postgres:16`) managed via [`docker-compose.yml`](file:///home/smog/StellarClear/stellarclear/docker-compose.yml) & [`Dockerfile`](file:///home/smog/StellarClear/stellarclear/Dockerfile) |
| **Deployed Testnet Contract ID** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Stellar Explorer Contract URL** | [`https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |
| **Application Release Tag** | [`v0.1.0`](https://github.com/StellarClear/stellarclear-app/releases/tag/v0.1.0) |
| **Application Release Commit** | `a554503060abd119dd43f308a45539f2df39fb18` |
| **Contract Release Tag** | [`v0.1.0`](https://github.com/StellarClear/stellarclear-contract/releases/tag/v0.1.0) |
| **Contract Release Commit** | `3978e21cebb0a60bd3899e7b48d7b96e40479a3c` |
| **Application `main` Commit** | `126c62c4a30e872c050a4980bbd4546554b5dfd4` |
| **Contract `main` Commit** | `2032666be97e8bf09ba9073952041ae3e4573ff1` |

---

## 4. Cryptographic Provenance Identifiers

### Deployed Contract Instance (Testnet v0.1.0)
- **Contract ID**: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- **WASM SHA-256**: `1018a81b1ac95046cb00466ceda7ee347204c08b71b1c51b3c9611dd32215d66`
- **WASM Byte Size**: `22,722 bytes` (optimized)
- **Target Network**: Stellar Testnet (`https://soroban-testnet.stellar.org`)
- **Pinned Reference**: [`packages/settlement-registry/src/release.ts`](file:///home/smog/StellarClear/stellarclear/packages/settlement-registry/src/release.ts)

### Continuous-Integration Reproducible Build (`main`)
- **Source Revision**: `2032666be97e8bf09ba9073952041ae3e4573ff1`
- **Toolchain**: Rust Stable (`wasm32v1-none`), Soroban SDK `27.0.4`, Stellar CLI `28.1.0`
- **WASM SHA-256**: `0073a4cb2027140ac34e4db6c64c2d4104590ec60cf0ef2e424909eba9ae36ac`
- **WASM Byte Size**: `32,773 bytes` (optimized with deterministic compiler flags)
- **Manifest Location**: [`artifacts/release-manifest.json`](file:///home/smog/StellarClear/stellarclear-contract/artifacts/release-manifest.json)

---

## 5. Verified Issues Reconciliation

### Completed & Reconciled Protocol Issues

| Issue # | Title | Repository | Resolution Reference | State |
| :--- | :--- | :--- | :--- | :--- |
| **[#16](https://github.com/StellarClear/stellarclear-app/issues/16)** | `feat(sdk,api): add observer quorum verification and threshold attestation support` | `stellarclear-app` | PR #25 / PR #26 (commits `2e854fc`, `f6a77bb`, `7fbddca`) | **Closed** |
| **[#17](https://github.com/StellarClear/stellarclear-app/issues/17)** | `feat(indexer): handle on-chain dispute expiration TTL events and state progression` | `stellarclear-app` | PR #25 / PR #26 (commits `c6fe8e3`, `7fbddca`) | **Closed** |
| **[#2](https://github.com/StellarClear/stellarclear-app/issues/2)** | `feat(indexer): add real-time websocket event subscription stream` | `stellarclear-app` | PR #25 / PR #26 (commit `7c17270`) | **Closed** |
| **[#3](https://github.com/StellarClear/stellarclear-app/issues/3)** | `test(e2e): automate multi-party attestation flow against testnet` | `stellarclear-app` | PR #25 / PR #26 (commits `28666a6`, `c32e610`) | **Closed** |
| **[#5](https://github.com/StellarClear/stellarclear-contract/issues/5)** | `feat(contract): implement observer quorum threshold logic` | `stellarclear-contract` | PR #14 (commit `2032666`) | **Closed** |
| **[#6](https://github.com/StellarClear/stellarclear-contract/issues/6)** | `feat(contract): enforce dispute expiration TTL` | `stellarclear-contract` | PR #14 (commit `2032666`) | **Closed** |

### Post-Release Operational Enhancements (Non-Blockers)

| Issue # | Title | Labels | Priority | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **[#18](https://github.com/StellarClear/stellarclear-app/issues/18)** | `feat(api): expose Prometheus-compatible metrics endpoint for operational telemetry` | `enhancement` | Low | **Post-Release Enhancement** |
| **[#19](https://github.com/StellarClear/stellarclear-app/issues/19)** | `feat(indexer): add exponential backoff and jitter for resilient RPC error recovery` | `enhancement` | Medium | **Post-Release Enhancement** |

---

## 6. Drips Approval & Next Phase Notice

- **Approval Status**: **Pending Maintainer Submission**.
- **Submission Path**: The repository maintainer will onboard the `StellarClear` GitHub organization via the [Drips Wave Maintainer Dashboard](https://www.drips.network/wave/stellar).
- **Phase Transition Notice**: Phase 13 (Post-Approval Maintenance & Operations) will strictly begin only after approval is independently confirmed on the Drips network.
