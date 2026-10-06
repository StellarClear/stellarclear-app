# TypeScript SDK Integration Guide

The `@stellarclear/sdk` package provides typed client bindings, deterministic commitment helpers, and normalized error handling.

## Installation

Within the monorepo:
```bash
npm install --workspace=@stellarclear/sdk
```

## Initializing StellarClearClient

```typescript
import { StellarClearClient, Networks } from "@stellarclear/sdk";

const client = new StellarClearClient({
  network: "testnet",
  networkPassphrase: Networks.TESTNET.networkPassphrase,
  rpcUrl: "https://soroban-testnet.stellar.org",
  contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
});
```

## Deterministic Case ID Generation

```typescript
// Computes deterministic 32-byte hex case identifier
const caseId = client.generateCaseId(
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "TRADE-EURUSD-001"
);

console.log("Generated Case ID:", caseId);
```

## Querying On-Chain State

```typescript
// Reads case state directly from Soroban contract
const settlementCase = await client.getCase(caseId);

if (settlementCase) {
  console.log("Status:", settlementCase.status);
  console.log("Terms Commitment:", settlementCase.terms_commitment.toString("hex"));
}
```

## Error Normalization

Soroban numeric error discriminants are automatically mapped into typed domain exceptions:

```typescript
import { ContractError, ErrorCodes } from "@stellarclear/sdk";

try {
  await client.getCase("invalid-case-id");
} catch (err) {
  if (err instanceof ContractError) {
    console.error(`Contract Error [${err.code}]: ${err.message}`);
  }
}
```
