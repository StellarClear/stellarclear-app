# Production Release Procedure

This document specifies the standard operating procedure for validating, pinning, deploying, and verifying production releases of the StellarClear protocol and application stack.

---

## 1. Overview & Architecture Scope

A production release encompasses the following synchronized layers:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Soroban SettlementRegistry Contract (WASM & Bindings)    │
│    - Bytecode wasmHash pinned in packages/settlement-registry│
│    - Network contract IDs & spec version (specVersion: 1)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 2. Core Protocol Libraries (@stellarclear/*)                │
│    - schemas, proof, db, sdk                                │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 3. Services Stack                                           │
│    - API Service (dispatcher & endpoints)                   │
│    - Indexer Service (Soroban event synchronization)        │
│    - Matcher Service (reconciliation engine)                │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Release Prerequisites & Gate Verification

Before initiating a release deployment, run the automated pre-release verification pipeline:

```bash
# 1. Clean build all workspaces
npm run build

# 2. Strict typechecking
npm run typecheck

# 3. Comprehensive test suites
npm test

# 4. Full pre-release readiness pipeline
npm run verify:release
```

All 54+ test suites (177+ individual tests) must pass with zero failures, type errors, or unhandled rejections.

---

## 3. Pinned Contract Release Verification

StellarClear binds its SDK, API, and Indexer to authoritative contract metadata defined in `SETTLEMENT_REGISTRY_RELEASE`:

```typescript
export const SETTLEMENT_REGISTRY_RELEASE = {
  name: "settlement_registry",
  version: "0.1.0",
  releaseTag: "v0.1.0",
  contractRepository: "https://github.com/StellarClear/stellarclear-contract",
  gitCommit: "2032666be97e8bf09ba9073952041ae3e4573ff1",
  artifactFile: "artifacts/settlement_registry.wasm",
  wasmHash: "0073a4cb2027140ac34e4db6c64c2d4104590ec60cf0ef2e424909eba9ae36ac",
  specVersion: 1,
  deployedNetworks: {
    testnet: {
      contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      deployedAtLedger: 5048699,
    },
    local: {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      networkPassphrase: "Standalone Network ; February 2024",
      rpcUrl: "http://localhost:8000/soroban/rpc",
      deployedAtLedger: 1,
    },
  },
  features: [
    "case_creation",
    "observation_anchoring",
    "match_reconciliation",
    "break_classification",
    "dispute_workflows",
    "arbitration_resolution",
    "multi_party_attestations",
    "onchain_finalization",
  ],
};
```

### Contract Provenance Lineage:
- **Artifact Build/Source Provenance Commit**: `fcd48d20736dda40e400e420c6e984a707f80e76` in `stellarclear-contract` (the specific source commit from which the released WASM binary was built).
- **Release Tag & Final Merge Commit**: `v0.1.0` tag pointing to `3978e21cebb0a60bd3899e7b48d7b96e40479a3c` in `stellarclear-contract` (the PR merge commit finalizing documentation and release verification).

### Verification Checklist:
- [ ] Contract bytecode hash matches `wasmHash` (`1018a81b1ac95046cb00466ceda7ee347204c08b71b1c51b3c9611dd32215d66`).
- [ ] Contract address on target network is a valid 56-character StrKey (`C...`).
- [ ] TypeScript bindings in `packages/settlement-registry` are generated from the target WASM.
- [ ] Network compatibility passes `verifyContractReleaseCompatibility(network, contractId)`.

---

## 4. Production Deployment Sequence

Deploy the StellarClear infrastructure in strict dependency order:

### Step 1: Database Migration
Ensure PostgreSQL schema and indexes are applied:
```bash
# Verify database connectivity and schema readiness
export DATABASE_URL="postgresql://user:pass@db.prod.stellarclear.io:5432/stellarclear"
```

### Step 2: Indexer Service Rollout
Deploy the event indexer first to capture real-time Soroban ledger events:
```bash
# Verify indexer starts from persisted checkpoint or genesis ledger
npm run start --workspace=@stellarclear/indexer
```

### Step 3: API & Matcher Services Rollout
Deploy the API server and reconciliation services:
```bash
# Start API dispatcher
npm run start --workspace=@stellarclear/api
```

---

## 5. Post-Deployment Smoke Tests & Operational Diagnostics

Immediately following deployment, query the operational diagnostic endpoints:

### 1. Version & Release Inspection
```bash
curl -f -s https://api.stellarclear.io/v1/version | jq
```
Expected response:
```json
{
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
}
```

### 2. Operational Health & Pipeline Metrics
```bash
curl -f -s https://api.stellarclear.io/v1/operations/diagnostics | jq
```
Verify that:
- `status` is `"healthy"`.
- `release.contract.compatible` is `true`.
- `database.status` is `"healthy"`.
- `contract.status` is `"healthy"`.
- `indexing.status` is `"synced"`.

### 3. Readiness Probe
```bash
curl -f -s https://api.stellarclear.io/ready | jq
```
Expected HTTP 200 with status `"ready"`.

---

## 6. Rollback & Emergency Procedures

In the event of an operational anomaly during rollout:

1. **Traffic Drainage**: Route ingress traffic away from newly deployed pods to the previous stable revision.
2. **Indexer State**: The Indexer is durable and idempotent. Cursor progression safely resumes upon re-pointing to previous revision binaries.
3. **Immutability Assurance**: Finalized settlement proofs and on-chain records remain authoritative and cannot be corrupted by API rollback.
