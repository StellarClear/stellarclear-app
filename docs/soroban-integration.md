# Soroban Smart Contract Integration

StellarClear integrates natively with the Soroban smart contract layer via the `SettlementRegistry` contract.

## Contract Specification

The `SettlementRegistry` Soroban contract interface defines the global on-chain state machine and data structures:

```rust
pub struct SettlementCase {
    pub owner: Address,
    pub counterparty: Option<Address>,
    pub terms_commitment: BytesN<32>,
    pub expires_at_ledger: u32,
    pub status: CaseStatus,
    pub observation: Option<Observation>,
    pub decision: Decision,
    pub created_at_ledger: u32,
    pub finalized_at_ledger: Option<u32>,
    pub observer_quorum: u32,
    pub dispute_expires_at_ledger: Option<u32>,
}
```

---

## Generated TypeScript Bindings

Bindings are generated directly from compiled Soroban contract WASM:

```bash
npm run generate:bindings
```

Located in `packages/settlement-registry`:
- `Client`: Direct RPC contract execution wrapper.
- Type definitions: `SettlementCase`, `Observation`, `Decision`, `CaseStatus`, `BreakCode`, `AttestationRole`, `Errors`.
- Spec exports: `networks`, `CONTRACT_SPEC`, `Errors` mapping.

---

## SDK Operations Integration

The high-level `SettlementRegistryOperations` class in `@stellarclear/sdk` provides typed abstractions over the generated bindings:

```typescript
import { StellarClearClient } from "@stellarclear/sdk";

const client = new StellarClearClient({
  network: "testnet",
  contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
  rpcUrl: "https://soroban-testnet.stellar.org",
});

// Operations available:
// - client.registry.createCase(terms, options)
// - client.registry.recordObservation({ observer, caseId, observation }, options)
// - client.registry.recordMatch({ observer, caseId }, options)
// - client.registry.recordBreak({ observer, caseId, breakCode }, options)
// - client.registry.submitAttestation({ attestor, caseId, role, commitment }, options)
// - client.registry.submitObserverAttestation({ observer, caseId, commitment }, options)
// - client.registry.setCaseQuorum({ owner, caseId, quorum }, options)
// - client.registry.getCaseQuorum(caseId, options)
// - client.registry.openDispute({ initiator, caseId, disputeCommitment }, options)
// - client.registry.openDisputeWithTtl({ initiator, caseId, disputeCommitment, disputeTtlLedgers }, options)
// - client.registry.expireDispute({ caseId }, options)
// - client.registry.submitResolution({ resolver, caseId, resolutionCommitment }, options)
// - client.registry.finalizeCase(caseId, options)
// - client.registry.getCase(caseId, options)
// - client.registry.getAttestation(caseId, attestor, options)
// - client.registry.isObserver(observer, options)
// - client.registry.getResolution(caseId, resolver, options)
```

---

## Contract Event Ingestion & Indexer

The `IndexerService` (`services/indexer`) polls Soroban RPC event endpoints and decodes topics into structured events:

```typescript
import { IndexerService } from "@stellarclear/indexer";

const indexer = new IndexerService({
  network: "testnet",
  contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
  rpcUrl: "https://soroban-testnet.stellar.org",
  pollIntervalMs: 2000,
}, dbClient);

// Starts resilient event polling, DB indexing, and WebSocket streaming
await indexer.start();
```

### Event Topics Decoded:
- `CaseCreated`: Case ID, owner, terms commitment.
- `CaseObserved`: Case ID, observer, observation commitment, transaction hash.
- `CaseMatched`: Case ID, matched decision.
- `CaseBroken`: Case ID, break code.
- `CaseAttested`: Case ID, attestor, role, commitment.
- `CaseQuorumSet`: Case ID, required quorum.
- `CaseDisputed`: Case ID, initiator, dispute commitment.
- `CaseResolved`: Case ID, resolver, resolution commitment.
- `DisputeExpired`: Case ID, expired at ledger.
- `CaseFinalized`: Case ID, final ledger sequence.

---

## Contract Error Handling & Normalization

Soroban numeric error codes are converted into typed TypeScript error instances (`StellarClearError`):

| Contract Error Code | Error Symbol | Description | Normalized SDK Error |
|:---|:---|:---|:---|
| 1 | `AlreadyInitialized` | Contract constructor already executed | `ConflictError` |
| 2 | `NotFound` | Requested record not found | `NotFoundError` |
| 3 | `CaseAlreadyExists` | Case ID already created on-chain | `ConflictError` |
| 4 | `ObserverAlreadyRegistered` | Observer address already whitelisted | `ConflictError` |
| 5 | `ObserverNotRegistered` | Caller is not a registered observer | `NotFoundError` |
| 6 | `Unauthorized` | Caller lacks authorization for operation | `UnauthorizedError` |
| 7 | `InvalidState` | Target case is not in valid state | `ValidationError` |
| 8 | `InvalidExpiration` | Expiration ledger not greater than current | `ValidationError` |
| 9 | `InvalidCommitment` | Commitment payload is zero or invalid | `ValidationError` |
| 10 | `CounterpartyRequired` | Operation requires a counterparty address | `ValidationError` |
| 11 | `CounterpartyNotAllowed` | Counterparty cannot be case owner | `ValidationError` |
| 12 | `AttestationAlreadyExists` | Attestation already submitted by party | `ConflictError` |
| 13 | `ResolutionAlreadySubmitted` | Resolution already submitted by party | `ConflictError` |
| 14 | `ResolutionMismatch` | Resolution commitments do not match | `ValidationError` |
| 15 | `MissingRequiredAttestation` | Required attestation missing for finalize | `ValidationError` |
| 16 | `InvalidDecision` | Decision invalid for current state | `ValidationError` |
| 17 | `InvalidLedger` | Observation ledger invalid or in future | `ValidationError` |
| 18 | `InvalidObserverQuorum` | Observer quorum must be positive integer | `ValidationError` |
| 19 | `ObserverQuorumNotMet` | Required observer quorum threshold not met | `ValidationError` |
| 20 | `DisputeNotExpired` | Current ledger is before dispute expiration | `ValidationError` |
| 21 | `DisputeAlreadyExpired` | Dispute has expired; resolutions rejected | `ValidationError` |

