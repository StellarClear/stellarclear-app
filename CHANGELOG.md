# Changelog

All notable changes tracked here. Format based on Keep a Changelog.

## [Unreleased]
- Community readiness: Apache-2.0 license, CI, contributing docs, README accuracy fixes.

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
