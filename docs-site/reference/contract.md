# SettlementRegistry Smart Contract Reference

The `SettlementRegistry` Soroban smart contract (hosted in `StellarClear/stellarclear-contract`) serves as the authoritative on-chain state machine and evidentiary anchor for StellarClear.

## Contract Metadata
- **Release Version**: `0.1.1` (Hardened release)
- **Soroban SDK**: `27.0.4`
- **Target**: `wasm32v1-none`
- **Active Testnet Contract ID**: `CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5`
- **Historical Prototype Contract ID (v0.1.0)**: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

---

## Public Contract Functions

### 1. `__constructor`
One-time constructor initializing contract administrator and version.
- **Parameters**: `admin: Address`
- **Authorization**: Deployer
- **Return Type**: `void`
- **State Effect**: Stores admin address in `DataKey::Admin` and version `0.1.0` in `DataKey::ContractVersion`.
- **Errors**: `AlreadyInitialized (1)`

### 2. `create_case`
Opens a new settlement case with terms commitment and expiration sequence.
- **Parameters**:
  - `case_id: BytesN<32>`
  - `owner: Address`
  - `counterparty: Option<Address>`
  - `terms_commitment: BytesN<32>`
  - `expires_at_ledger: u32`
- **Authorization**: Case Owner (`owner.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Stores `SettlementCase` record with initial status `Open`.
- **Emitted Event**: `CaseCreated(case_id, owner, counterparty, expires_at_ledger)`
- **Errors**: `CaseAlreadyExists (3)`, `InvalidExpiration (8)`, `InvalidCommitment (9)`, `CounterpartyNotAllowed (11)`

### 3. `record_observation`
Records an observed Stellar payment transaction for an open settlement case.
- **Parameters**:
  - `observer: Address`
  - `case_id: BytesN<32>`
  - `tx_hash: BytesN<32>`
  - `observed_ledger: u32`
  - `observation_commitment: BytesN<32>`
- **Authorization**: Authorized Observer (`observer.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Transitions case status from `Open` to `Observed` and records `ObservationRecord`.
- **Emitted Event**: `CaseObserved(case_id, tx_hash, observed_ledger, observation_commitment)`
- **Errors**: `NotFound (2)`, `ObserverNotRegistered (5)`, `InvalidState (7)`, `InvalidLedger (17)`

### 4. `record_match`
Records a clean reconciliation match decision.
- **Parameters**:
  - `observer: Address`
  - `case_id: BytesN<32>`
- **Authorization**: Authorized Observer (`observer.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Sets decision to `Matched` and transitions status to `Matched`.
- **Emitted Event**: `CaseMatched(case_id, observer)`
- **Errors**: `NotFound (2)`, `ObserverNotRegistered (5)`, `InvalidState (7)`

### 5. `record_break`
Records a reconciliation discrepancy with a standardized break code.
- **Parameters**:
  - `observer: Address`
  - `case_id: BytesN<32>`
  - `break_code: BreakCode`
- **Authorization**: Authorized Observer (`observer.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Sets decision to `Break(break_code)` and transitions status to `Break`.
- **Emitted Event**: `CaseBroken(case_id, observer, break_code)`
- **Errors**: `NotFound (2)`, `ObserverNotRegistered (5)`, `InvalidState (7)`

### 6. `open_dispute` / `open_dispute_with_ttl`
Opens a formal dispute on a broken settlement case (optionally with an expiration TTL window).
- **Parameters (`open_dispute`)**:
  - `initiator: Address`
  - `case_id: BytesN<32>`
  - `dispute_commitment: BytesN<32>`
- **Parameters (`open_dispute_with_ttl`)**:
  - `initiator: Address`
  - `case_id: BytesN<32>`
  - `dispute_commitment: BytesN<32>`
  - `dispute_ttl_ledgers: u32`
- **Authorization**: Owner or Counterparty (`initiator.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Transitions case status from `Break` to `Disputed`, records dispute commitment and optional `dispute_expires_at_ledger`.
- **Emitted Event**: `DisputeOpened(case_id, initiator, dispute_commitment)`
- **Errors**: `NotFound (2)`, `Unauthorized (6)`, `InvalidState (7)`, `InvalidCommitment (9)`, `InvalidExpiration (8)`

### 7. `expire_dispute`
Permissionlessly expires an active dispute whose TTL ledger window has elapsed.
- **Parameters**: `case_id: BytesN<32>`
- **Authorization**: None (Permissionless operational trigger)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Transitions case status from `Disputed` back to `Break`, clears active resolution submissions.
- **Emitted Event**: `DisputeExpired(case_id, expired_at_ledger)`
- **Errors**: `NotFound (2)`, `InvalidState (7)`, `DisputeNotExpired (20)`, `DisputeAlreadyExpired (21)`

### 8. `submit_resolution`
Submits bilateral resolution commitment terms.
- **Parameters**:
  - `resolver: Address`
  - `case_id: BytesN<32>`
  - `resolution_commitment: BytesN<32>`
- **Authorization**: Owner or Counterparty (`resolver.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Stores resolution commitment; transitions status to `Resolved` once both parties submit matching commitments.
- **Emitted Event**: `DisputeResolved(case_id, resolution_commitment)`
- **Errors**: `NotFound (2)`, `Unauthorized (6)`, `InvalidState (7)`, `ResolutionAlreadySubmitted (13)`, `ResolutionMismatch (14)`, `DisputeAlreadyExpired (21)`

### 9. `submit_attestation` / `submit_observer_attestation`
Submits a cryptographic attestation for an active settlement case.
- **Parameters (`submit_attestation`)**:
  - `case_id: BytesN<32>`
  - `role: AttestationRole`
  - `commitment: BytesN<32>`
- **Parameters (`submit_observer_attestation`)**:
  - `observer: Address`
  - `case_id: BytesN<32>`
  - `commitment: BytesN<32>`
- **Authorization**: Attestor / Observer (`signer.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Persists `Attestation` record under `DataKey::Attestation(case_id, signer)`.
- **Emitted Event**: `CaseAttested(case_id, signer, role)`
- **Errors**: `NotFound (2)`, `AttestationAlreadyExists (12)`, `InvalidCommitment (9)`, `ObserverNotRegistered (5)`

### 10. `set_case_quorum` & `get_case_quorum`
Configures and queries the required observer quorum threshold for a settlement case.
- **Parameters (`set_case_quorum`)**: `owner: Address`, `case_id: BytesN<32>`, `quorum: u32`
- **Parameters (`get_case_quorum`)**: `case_id: BytesN<32>`
- **Authorization**: Case Owner (`owner.require_auth()`) for setter; public for getter.
- **Return Type**: `Result<void, Error>` (setter) / `Result<u32, Error>` (getter)
- **Emitted Event**: `CaseQuorumSet(case_id, quorum)`
- **Errors**: `NotFound (2)`, `Unauthorized (6)`, `InvalidObserverQuorum (18)`

### 11. `finalize_case`
Immutably seals a matched or resolved settlement case once observer quorum is satisfied.
- **Parameters**: `case_id: BytesN<32>`
- **Authorization**: Case Owner (`owner.require_auth()`)
- **Return Type**: `Result<void, Error>`
- **State Effect**: Validates `distinctObserverCount >= observer_quorum`; transitions status to `Finalized` and records `finalized_at_ledger`.
- **Emitted Event**: `CaseFinalized(case_id, finalized_at_ledger)`
- **Errors**: `NotFound (2)`, `Unauthorized (6)`, `InvalidState (7)`, `ObserverQuorumNotMet (19)`

### 12. `get_case`
Reads full on-chain settlement case record.
- **Parameters**: `case_id: BytesN<32>`
- **Authorization**: Public (Read-Only)
- **Return Type**: `Result<SettlementCase, Error>`

### 13. `get_attestation`
Reads an attestation record by case ID and attestor address.
- **Parameters**: `case_id: BytesN<32>`, `attestor: Address`
- **Authorization**: Public (Read-Only)
- **Return Type**: `Option<Attestation>`

### 14. `get_resolution`
Reads resolution commitment by case ID and resolver address.
- **Parameters**: `case_id: BytesN<32>`, `resolver: Address`
- **Authorization**: Public (Read-Only)
- **Return Type**: `Option<BytesN<32>>`

### 15. Observer Whitelist Management
- **`add_observer({ observer: Address })`**: Admin-only. Registers new observer. Emits `ObserverAdded`.
- **`remove_observer({ observer: Address })`**: Admin-only. Revokes observer. Emits `ObserverRemoved`.
- **`is_observer({ observer: Address })`**: Public. Returns boolean.
