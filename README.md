# StellarClear

<div align="center">

<!-- Banner / Logo -->
<p align="center">
  <img src="assets/banner.jpeg" alt="StellarClear Banner" width="100%"/>
</p>

[![CI](https://github.com/StellarClear/stellarclear-app/actions/workflows/ci.yml/badge.svg)](https://github.com/StellarClear/stellarclear-app/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Soroban](https://img.shields.io/badge/Soroban-v27.0-purple.svg)](https://stellar.org/soroban)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](https://github.com/StellarClear/stellarclear-app/releases/tag/v0.1.0)

<p align="center">
  <strong>Open-source Stellar-native settlement evidence and reconciliation protocol.</strong>
</p>

</div>

---

## The Problem

Traditional financial settlements between trading counterparties rely on manual reconciliation across disjoint spreadsheets and siloed internal databases, resulting in delayed dispute discovery, conflicting records, and unanchored audit trails. When payments execute on the Stellar network, off-chain bilateral trade agreements and on-chain ledger transfers still require deterministic, automated matching without exposing confidential commercial terms to public ledgers.

StellarClear solves this by automatically comparing bilateral settlement commitments against observed Stellar payments, mathematically classifying breaks, and anchoring tamper-evident cryptographic commitments to Soroban smart contracts.

> **Non-Custodial Boundary**: StellarClear **does NOT** move funds, hold user custody, or run escrow mechanisms. All token and asset transfers occur directly between counterparties' own Stellar accounts. StellarClear operates solely as an off-chain reconciliation engine, proof generator, and on-chain evidentiary audit anchor.

---

## Overview

StellarClear provides cryptographic certainty and operational visibility for institutional and peer-to-peer financial settlements on Stellar.

The protocol continuously compares:
1. **Expected Settlement Instructions** (off-chain bilateral agreements, trade parameters, deadlines), and
2. **Observed Stellar Transactions** (on-chain payments, ledger sequences, timestamps, asset transfers),

and produces:
- **Deterministic Reconciliation**: Automated exact match verification or standardized break classification.
- **Cryptographic Commitments**: SHA-256 canonical commitments binding off-chain terms to on-chain state without leaking confidential trade terms.
- **On-Chain Soroban Anchoring**: Immutable settlement evidence recorded in the `SettlementRegistry` contract.
- **Multi-Party Attestation**: Cryptographic confirmations signed by owners, counterparties, and independent observers.
- **Portable Settlement Proofs**: Self-contained JSON artifacts verifiable offline and against live Soroban state.

> **Contract Repository**: The smart contract implementation is hosted in [`StellarClear/stellarclear-contract`](https://github.com/StellarClear/stellarclear-contract) (`SettlementRegistry`). This monorepo consumes generated TypeScript bindings in `packages/settlement-registry`.

---

## Architecture

StellarClear combines high-throughput off-chain processing with tamper-evident on-chain anchoring:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           Off-Chain Layer                               │
│  ┌───────────────────────┐       ┌───────────────────────────────────┐  │
│  │   Private Trade Data  │       │         Matcher Engine            │  │
│  │  (Expected & Observed)│ ───►  │  (Reconcile & Break Taxonomy)    │  │
│  └───────────────────────┘       └─────────────────┬─────────────────┘  │
│              │                                     │                    │
│              ▼                                     ▼                    │
│  ┌───────────────────────┐       ┌───────────────────────────────────┐  │
│  │     Proof Engine      │       │            REST API               │  │
│  │ (SHA-256 Commitments) │ ◄───► │   (Endpoints, Audit & Probes)     │  │
│  └───────────────────────┘       └─────────────────┬─────────────────┘  │
└────────────────────────────────────────────────────┼────────────────────┘
                                                     │ Anchors & Verifies
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Stellar & Soroban On-Chain Layer                  │
│  ┌──────────────────────────────┐     ┌──────────────────────────────┐  │
│  │      SettlementRegistry      │     │      Streaming Indexer       │  │
│  │  (Soroban Smart Contract)    │ ──► │  (Event Sync & Checkpoints)  │  │
│  └──────────────────────────────┘     └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **API Service (`services/api`)**: Dispatcher providing REST endpoints for case creation, observations, reconciliation, attestations, disputes, and operational health diagnostics.
- **Matcher Service (`services/matcher`)**: Pure deterministic reconciliation engine performing exact string/decimal arithmetic and break classification.
- **Indexer Service (`services/indexer`)**: Streaming ledger ingestion service that decodes Soroban contract events, maintains failure-safe checkpoints, and provides real-time WebSocket event streaming.
- **Proof Package (`packages/proof`)**: Canonical deterministic JSON serialization (`RFC 8785`) and SHA-256 commitment generation.
- **Database Package (`packages/db`)**: Repository abstraction supporting PostgreSQL with strict idempotency, dispute evidence persistence, and state deduplication.
- **Client SDK (`packages/sdk`)**: TypeScript client library with typed contract bindings, error normalization, observer quorum APIs, and lifecycle helpers.

---

## How It Works

### Worked Example: Bilateral Settlement Lifecycle

Consider **Company A** (`GBRP...`) and **Company B** (`GA5Z...`) agreeing off-chain that Company A will pay **1,000 USDC** to Company B before ledger sequence `2000000`:

1. **Case Creation (`OPEN`)**:
   - Company A registers the expected settlement terms via API or SDK.
   - The canonical `termsCommitment` hash is generated and anchored on Soroban via `create_case`.
   - Observer quorum requirement is configured (default `1`).
2. **Transaction Observation (`OBSERVED`)**:
   - Company A executes a standard Stellar payment of 1,000 USDC directly to Company B.
   - The payment transaction details (`txHash`, `amount`, `asset`, `destination`, `ledger`) are ingested.
   - The canonical `observationCommitment` is anchored on Soroban via `record_observation`.
3. **Deterministic Reconciliation (`MATCHED` or `BREAK`)**:
   - The matcher verifies if amount, asset, destination, reference, deadline, and status match agreed terms.
   - **Clean Match**: Status transitions to `MATCHED`.
   - **Discrepancy (Break)**: Status transitions to `BREAK` with a standardized `BreakCode` recorded on Soroban via `record_break`.
4. **Dispute & Mutual Resolution Path (If Break occurs)**:
   - Either counterparty submits a dispute with supporting evidence (`DISPUTED`) via `open_dispute` (strictly guarded: only permitted from `BREAK` status).
   - **Mutual Resolution**: Both owner and counterparty must submit matching resolution commitments before the case transitions to `RESOLVED`. The first submission remains `DISPUTED`.
   - **Dispute Expiration**: If an optional TTL ledger sequence elapses without mutual agreement, any participant can trigger `expire_dispute`, returning the case to `BREAK`.
5. **Multi-Party Attestation & Proof Generation**:
   - Owner, counterparty, or registered observers submit cryptographic signatures (`CaseAttested`).
   - A self-contained `SettlementProof` bundle is assembled.
6. **Finalization (`FINALIZED`)**:
   - Finalization verifies that the required `M-of-N` distinct observer quorum is satisfied.
   - The case is finalized on Soroban via `finalize_case`, immutably locking the record against further state modifications.

### State Machine

```
         ┌───────────────┐
         │     OPEN      │  (Expected terms anchored on-chain)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │   OBSERVED    │  (Payment observed on Stellar ledger)
         └───────┬───────┘
                 │
        Reconciliation Check
        ┌────────┴────────┐
        ▼                 ▼
 ┌─────────────┐   ┌─────────────┐
 │   MATCHED   │   │    BREAK    │  (Classified with BreakCode)
 └──────┬──────┘   └──────┬──────┘
        │                 │
        │                 ▼
        │          ┌─────────────┐
        │          │  DISPUTED   │◄───────┐
        │          └──────┬──────┘        │ (Single resolution /
        │                 │               │  remains DISPUTED)
        │       ┌─────────┴─────────┐     │
        │       │ (Mutual Agreement)│     │
        │       ▼                   ▼     │
        │ ┌─────────────┐    (TTL Expired)│
        │ │  RESOLVED   │    ──► BREAK ───┘
        │ └──────┬──────┘
        │        │
        └────────┼────────┐
                 ▼        │ (Enforces Observer Quorum)
         ┌───────────────┐│
         │   FINALIZED   │◄
         └───────────────┘
```

### Standardized Break Taxonomy

When reconciliation fails, the matcher produces one of the following exact `BreakCode` values:

| Break Code | Classification Description |
| :--- | :--- |
| `AMOUNT_MISMATCH` | Observed transfer amount differs from the expected agreed amount. |
| `ASSET_MISMATCH` | Observed Stellar asset code or issuer does not match agreed asset terms. |
| `DESTINATION_MISMATCH` | Observed payment was transferred to an address other than `expectedDestination`. |
| `REFERENCE_MISMATCH` | Observed payment memo or reference tag does not match agreed trade reference. |
| `MISSING_SETTLEMENT` | No matching payment transaction observed before deadline expiration. |
| `DUPLICATE_SETTLEMENT` | Multiple conflicting payment transactions observed for a single settlement case. |
| `LATE_SETTLEMENT` | Observed transaction ledger sequence or timestamp occurred after agreed deadline. |
| `FAILED_TRANSACTION` | Observed Stellar transaction completed with a failed execution status. |
| `UNEXPECTED_TRANSACTION` | Observed transaction occurred with invalid or unregistered settlement metadata. |

---

## Example Usage

### 1. API Ingestion (`POST /v1/cases`)

**Request**:
```bash
curl -X POST http://localhost:3000/v1/cases \
  -H "Content-Type: application/json" \
  -d '{
    "expected": {
      "caseId": "1212121212121212121212121212121212121212121212121212121212121212",
      "owner": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      "counterparty": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "tradeReference": "TRADE-EURUSD-001",
      "asset": "EURC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "1000.0000000",
      "expectedDestination": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      "reference": "INV-2026-001",
      "deadline": 2000000
    }
  }'
```

**Response (`201 Created`)**:
```json
{
  "case": {
    "caseId": "1212121212121212121212121212121212121212121212121212121212121212",
    "status": "OPEN",
    "termsCommitment": "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
    "createdAt": "2026-10-01T12:00:00.000Z"
  }
}
```

### 2. Client SDK Usage

```typescript
import { StellarClearClient, Networks } from "@stellarclear/sdk";

// 1. Initialize client
const client = new StellarClearClient({
  network: "testnet",
  networkPassphrase: Networks.TESTNET.networkPassphrase,
  rpcUrl: "https://soroban-testnet.stellar.org",
  contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
});

// 2. Generate deterministic case identifier
const caseId = client.generateCaseId(
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "TRADE-EURUSD-001"
);

// 3. Query on-chain settlement state
const onchainCase = await client.getCase(caseId);
console.log("On-chain Status:", onchainCase?.status);
```

### 3. Sample Settlement Proof (`SettlementProof`)

```json
{
  "protocol": "STELLARCLEAR",
  "version": "0.1.0",
  "caseId": "1212121212121212121212121212121212121212121212121212121212121212",
  "termsCommitment": "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
  "observationCommitment": "f0e1d2c3b4a59876543210fedcba9876543210fedcba9876543210fedcba9876",
  "txHash": "3434343434343434343434343434343434343434343434343434343434343434",
  "finalizedLedger": 2000100,
  "result": "MATCHED",
  "attestations": [
    {
      "role": "OWNER",
      "signer": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      "signature": "304502210089abcdef...",
      "attestedAt": "2026-10-01T12:05:00.000Z"
    },
    {
      "role": "COUNTERPARTY",
      "signer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "signature": "3044022011abcdef...",
      "attestedAt": "2026-10-01T12:06:00.000Z"
    }
  ],
  "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
  "network": "testnet"
}
```

---

## Trust Model & Privacy Boundary

| Role / Entity | Capabilities & Responsibilities | Trust Assumptions |
| :--- | :--- | :--- |
| **Case Owner** | Submits expected settlement instructions and signs owner attestations. | Assumed to agree with trade terms prior to anchoring. |
| **Counterparty** | Executes payment on Stellar and submits counterparty attestations. | Relies on contract to anchor exact terms hash and dispute rights. |
| **Observers** | Authorized independent verifiers or automated oracles registered on-chain. | Authorized on-chain by admin; can submit neutral witness attestations. |
| **Contract Admin** | Configures contract parameters and registers observer public keys. | Multi-sig administrator; cannot mutate existing finalized cases. |

### On-Chain vs. Off-Chain Separation

- **What Goes On-Chain (Soroban `SettlementRegistry`)**:
  - Deterministic 32-byte SHA-256 hashes (`termsCommitment`, `observationCommitment`, `resolutionCommitment`).
  - Stellar payment transaction hash (`txHash`) and ledger sequence.
  - Lifecycle state machine status (`CaseStatus`).
  - Participant public keys, attestation signatures, and `BreakCode` identifiers.
- **What Stays Off-Chain (Private Databases)**:
  - Counterparty identities, account notes, commercial contracts, and trade descriptions.
  - Raw financial transaction metadata and internal accounting references.

---

## Glossary

- **`termsCommitment`**: SHA-256 cryptographic digest of canonical JSON-serialized expected settlement terms (`STELLARCLEAR/TERMS/V1`).
- **`observationCommitment`**: SHA-256 cryptographic digest of canonical JSON-serialized observed payment transaction data (`STELLARCLEAR/OBSERVATION/V1`).
- **`resolutionCommitment`**: SHA-256 cryptographic digest of canonical terms agreed upon during dispute resolution (`STELLARCLEAR/RESOLUTION/V1`).
- **`Observer`**: An authorized independent third party registered on-chain in `SettlementRegistry` capable of submitting attestations.
- **`Attestation`**: A cryptographic signature submitted by an owner, counterparty, or observer confirming agreement with a case state.
- **`BreakCode`**: A standardized machine-readable error code classifying the exact parameter variance during reconciliation.
- **`Settlement Proof`**: A portable, self-contained JSON artifact proving a settlement occurred, reconciled, and anchored to Soroban.

---

## Monorepo Structure

```text
stellarclear-app/
├── packages/
│   ├── schemas/               # Protocol Zod schemas and TypeScript domain models
│   ├── proof/                 # Canonical serialization and proof generator/verifier
│   ├── db/                    # Settlement persistence layer (PostgreSQL & In-Memory)
│   ├── settlement-registry/   # Generated Soroban contract TypeScript bindings
│   └── sdk/                   # StellarClear TypeScript client SDK
├── services/
│   ├── matcher/               # Deterministic settlement reconciliation engine
│   ├── indexer/               # Durable Stellar & Soroban event ingestion service
│   └── api/                   # REST API service (Fastify-compatible dispatcher)
├── docs/                      # Technical architecture and operational specifications
└── tests/                     # Unit, security, and live Soroban integration tests
```

---

## Quick Start

### Prerequisites
- **Node.js**: `>=22.12.0`
- **npm**: `>=10.0.0`
- **Stellar CLI**: (Optional, for contract deployment/bindings)

### Installation & Build

```bash
# 1. Clone the repository
git clone https://github.com/StellarClear/stellarclear-app.git
cd stellarclear-app

# 2. Clean install dependencies
npm ci

# 3. Build all workspace packages and services
npm run build

# 4. Run the full test suite (192+ tests)
npm test
```

### Run a Demo Case Locally

Execute the in-memory end-to-end multi-party settlement match test suite:

```bash
# Runs the full bilateral match, attestation, proof, and finalization pipeline
npm run test:integration
```

### Modular Test Pipelines

```bash
npm run test:unit         # Unit and contract release tests
npm run test:api          # API endpoints & operational health diagnostics
npm run test:security     # Adversarial security & idempotency regression tests
npm run test:indexer      # Indexer & event synchronization tests
npm run test:integration  # Live Soroban contract integration tests

# Run comprehensive 8-stage pre-release verification pipeline
npm run verify:release
```

---

## Environment Configuration

Copy the example environment file to configure network and database connections:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `STELLAR_NETWORK` | Target Stellar network | `testnet` |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` |
| `STELLAR_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `STELLAR_CONTRACT_ID` | Deployed `SettlementRegistry` ID | `CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5` |
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://postgres:postgres@localhost:5432/stellarclear` |
| `API_PORT` | REST API HTTP port | `3000` |

---

## Documentation

| Document | Description |
| :--- | :--- |
| [`docs/api.md`](./docs/api.md) | REST API endpoint reference, request/response schemas, idempotency semantics, and error codes. |
| [`docs/architecture.md`](./docs/architecture.md) | System architecture, component responsibilities, layer separation, and end-to-end data flow. |
| [`docs/deployment.md`](./docs/deployment.md) | Deployment guide for development, staging (Testnet), and production environments with Docker configurations. |
| [`docs/integration-verification.md`](./docs/integration-verification.md) | Guide for executing unit, API, indexer, security regression, and live Soroban test suites. |
| [`docs/operations.md`](./docs/operations.md) | Production operations, health/readiness probes, telemetry, cursor monitoring, and incident response playbooks. |
| [`docs/production-release-procedure.md`](./docs/production-release-procedure.md) | Standard operating procedure for validating, pinning, deploying, and verifying production releases. |
| [`docs/proof-verification.md`](./docs/proof-verification.md) | Technical specification for canonical domain serialization, commitments, and offline/online proof verification. |
| [`docs/release-candidate-runbook.md`](./docs/release-candidate-runbook.md) | Step-by-step release candidate verification, operational diagnostic gates, and rollback runbook. |
| [`docs/release-readiness.md`](./docs/release-readiness.md) | Pre-flight release verification criteria, artifact pinning requirements, and test audit checklists. |
| [`docs/settlement-lifecycle.md`](./docs/settlement-lifecycle.md) | State machine specification, lifecycle transitions, break taxonomy, and dispute/arbitration workflows. |
| [`docs/soroban-integration.md`](./docs/soroban-integration.md) | Soroban smart contract interface details, TypeScript bindings integration, and event streaming. |
| [`docs/troubleshooting.md`](./docs/troubleshooting.md) | Diagnostic workflows for resolving reconciliation breaks, RPC connectivity issues, and database sync problems. |

---

## Maintainers

| Maintainer | Role | GitHub |
| :--- | :--- | :--- |
| **Adejumo** | Lead Developer & Maintainer | [@Adejumo-2](https://github.com/Adejumo-2) |
| **Smog** | Core Contributor & Maintainer | [@smog123](https://github.com/smog123) |

---

## Community & Discussions

- **GitHub Discussions**: [StellarClear Discussions](https://github.com/StellarClear/stellarclear-app/discussions)
- **Issues & Roadmap**: [GitHub Issues](https://github.com/StellarClear/stellarclear-app/issues)
- **Stellar Developers**: [Stellar Developer Discord](https://discord.gg/stellardev)

---

## Contributing

Contributions are welcome! Please check our open issues and read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development workflows, branch naming, and pull request guidelines.

---

## Contributors

Made with [contrib.rocks](https://contrib.rocks).

<a href="https://github.com/StellarClear/stellarclear-app/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=StellarClear/stellarclear-app" alt="StellarClear Contributors" />
</a>

---

## License

Apache-2.0 — see [`LICENSE`](./LICENSE) for details.
