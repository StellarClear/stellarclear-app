# Settlement Proofs & Multi-Party Attestation

A **Settlement Proof** is a self-contained, portable cryptographic JSON artifact that proves a financial settlement occurred, reconciled, and finalized on Stellar and Soroban.

## Sample Settlement Proof JSON

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
    },
    {
      "role": "OBSERVER",
      "signer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "signature": "304502210044abcdef...",
      "attestedAt": "2026-10-01T12:06:30.000Z"
    }
  ],
  "contractId": "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
  "network": "testnet"
}
```

## Multi-Party Attestation Model

Attestations represent cryptographically signed affirmations from authorized entities participating in the settlement:

- **Owner Attestation (`OWNER`)**: Signed by the initiating case owner confirming trade parameters and execution agreement.
- **Counterparty Attestation (`COUNTERPARTY`)**: Signed by the recipient/payer confirming observed settlement receipt.
- **Observer Attestation (`OBSERVER`)**: Signed by an authorized independent witness or oracle node registered on the `SettlementRegistry` contract.

## Proof Verification Algorithm

A verifier can validate a Settlement Proof offline or against the live Soroban contract:

1. **Schema Validation**: Validates all JSON fields against `@stellarclear/schemas`.
2. **Offline Commitment Matching**: Recomputes SHA-256 hashes for expected terms and observed transaction documents and asserts equality with `termsCommitment` and `observationCommitment`.
3. **Signature Verification**: Verifies cryptographic signatures for each participant against their declared Stellar StrKey public key (`G...`).
4. **On-Chain State Verification (Optional)**: Queries `SettlementRegistry.get_case(caseId)` via Soroban RPC to confirm on-chain status is `Finalized` and commitments match contract storage.
