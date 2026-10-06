# Changelog

All notable changes tracked here. Format based on Keep a Changelog.

## [0.1.1] - 2026-10-06
- Authoritative contract v0.1.1 deployment (`CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5`) on Stellar Testnet matching exact bytecode SHA-256 (`0073a4cb2027140ac34e4db6c64c2d4104590ec60cf0ef2e424909eba9ae36ac`, 32,773 bytes).
- Live Testnet E2E Evidence: executed real on-chain transaction flows A through G (Clean Match, Negative Quorum enforcement, Pure M-of-N satisfaction without initial observer, Historical Attestation survival across observer revocation, Dispute & Mutual Resolution, Dispute Expiration TTL bounds enforcement, and Finalized Immutability).
- Pinned release configuration synchronized while strictly isolating historical v0.1.0 prototype (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) for provenance.
- Generated contract bindings fully aligned with all 21 public entrypoints and event interfaces.
- Issue reconciliation completed: closed protocol issues #16, #17, #2, #3 on `stellarclear-app` and #5, #6 on `stellarclear-contract`; classified #18 and #19 as non-blocking post-release operational enhancements.
- Updated authoritative Drips submission package with verified live transaction evidence and explorer links.

## [0.1.0] - 2026-10
- Initial settlement evidence + reconciliation protocol (schemas, proof, sdk, db, indexer, matcher, api).
- Pinned `SettlementRegistry` v0.1.0 release metadata, deployment configs, and end-to-end Soroban verification.
- Observer quorum: pure M-of-N threshold verification in SDK & API with historical attestation persistence and revocation safety.
- Dispute state machine: strict BREAK-only dispute entry and mutual matching resolution requirement.
- Dispute expiration TTL: indexer ingestion of `DisputeExpired` events with automatic transition back to BREAK.
- Streaming indexer & WebSocket: atomic cursor failure isolation and real-time contract event stream with bounded replay buffer and DB fallback.
- Transaction hash integrity: strict 64-character hex transaction hash validation with elimination of simulated hashes from production paths.
- Structured settlement health diagnostics (`/v1/operations/diagnostics`, `/v1/version`).
- Multi-party attestation, arbitration dispute workflows, and on-chain Soroban finalization.
- Security and replay hardening regression test suites with idempotency tamper protection.
- Automated 8-stage pre-release readiness verification pipeline (`scripts/release-check.sh`).
