# Freighter and Lobstr Wallet Signing Integration Guide

This guide provides step-by-step instructions and reference implementations for integrating **Freighter** and **Lobstr** wallets with StellarClear. Counterparties, case owners, and independent observers can sign settlement commitments, attestations, and Soroban contract invocations non-custodially directly from browser-based dApps and client applications.

---

## 1. Overview & Signing Architecture

StellarClear relies on cryptographic commitments and observer attestations anchored on the Stellar network via the `SettlementRegistry` Soroban smart contract.

```
+------------------------+        +--------------------------+        +-----------------------------+
|    User / Observer     |        |   StellarClear dApp/SDK  |        |      Soroban Contract       |
| (Freighter / Lobstr)   |        |  (@stellar/freighter-api)|        |    (SettlementRegistry)     |
+------------------------+        +--------------------------+        +-----------------------------+
            |                                   |                                    |
            | 1. Request Access / Address       |                                    |
            |<----------------------------------|                                    |
            | 2. Approve Public Key             |                                    |
            |---------------------------------->|                                    |
            |                                   | 3. Build Auth Entry / XDR Tx       |
            |                                   |---------------------------------->|
            | 4. Sign Auth Entry / Tx           |                                    |
            |<----------------------------------|                                    |
            | 5. Return Signed Signature / XDR  |                                    |
            |---------------------------------->|                                    |
            |                                   | 6. Submit Transaction / Quorum     |
            |                                   |----------------------------------->|
            |                                   | 7. Emit CaseFinalized Event        |
            |                                   |<-----------------------------------|
```

### Wallet Signing vs. Backend Signing
- **Case Owners & Counterparties**: Sign terms commitments (`record_match`, `open_dispute`, `resolve_dispute`) with their own funded Stellar accounts.
- **Independent Observers**: Sign witness attestations (`OBSERVER` role) to fulfill the M-of-N quorum required for case finalization.

---

## 2. Freighter Wallet Integration

[Freighter](https://www.freighter.app/) is the non-custodial browser extension wallet created by the Stellar Development Foundation.

### Installation & Dependency Setup

Install the official Freighter API package:

```bash
npm install @stellar/freighter-api @stellar/stellar-sdk
```

### Checking Availability & Requesting Access

Before requesting signatures, check if Freighter is installed and request user authorization:

```typescript
import {
  isConnected,
  isAllowed,
  requestAccess,
  getPublicKey,
  getNetworkDetails,
} from "@stellar/freighter-api";

export async function connectFreighter(): Promise<string> {
  // Check if Freighter extension is installed
  const hasFreighter = await isConnected();
  if (!hasFreighter) {
    throw new Error("Freighter wallet extension is not installed. Please install it from https://freighter.app");
  }

  // Request user permission to connect
  const accessObj = await requestAccess();
  if (accessObj.error) {
    throw new Error(`Freighter connection rejected: ${accessObj.error}`);
  }

  // Retrieve active public key and network details
  const publicKey = await getPublicKey();
  const network = await getNetworkDetails();

  console.log(`Connected to Freighter: ${publicKey} on ${network.networkPassphrase}`);
  return publicKey;
}
```

---

### Signing Soroban Authorization Entries (`signAuthEntry`)

Soroban contracts use authorization entries (`SorobanAuthorizationEntry`) so that callers can authorize specific invocations without necessarily submitting the outer Stellar transaction envelope.

```typescript
import { signAuthEntry } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

export interface ObserverSignaturePayload {
  caseId: string;
  authEntryXdr: string;
  networkPassphrase?: string;
}

/**
 * Sign a Soroban Authorization Entry with Freighter for M-of-N Observer Quorum.
 */
export async function signObserverAuthEntry(
  authEntryXdr: string,
  networkPassphrase = Networks.TESTNET
): Promise<string> {
  const result = await signAuthEntry(authEntryXdr, {
    networkPassphrase,
  });

  if (result.error) {
    throw new Error(`Observer signature rejected in Freighter: ${result.error}`);
  }

  // Returns the signed SorobanAuthorizationEntry XDR base64
  return result.signedAuthEntry;
}
```

---

### Signing Full Stellar Transactions (`signTransaction`)

When submitting direct contract invocations or anchor settlements:

```typescript
import { signTransaction } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

/**
 * Sign an unsigned Stellar transaction envelope XDR with Freighter.
 */
export async function signCaseTransaction(
  unsignedTxXdr: string,
  networkPassphrase = Networks.TESTNET
): Promise<string> {
  const result = await signTransaction(unsignedTxXdr, {
    networkPassphrase,
  });

  if (result.error) {
    throw new Error(`Transaction signing failed: ${result.error}`);
  }

  return result.signedTxXdr;
}
```

---

## 3. Lobstr Wallet Integration

[Lobstr](https://lobstr.co/) is a leading mobile and web wallet for the Stellar network supporting SEP-0007 URI delegation and multi-signature security (via Lobstr Vault).

### SEP-0007 URI Scheme Integration

Lobstr supports the Stellar Ecosystem Proposal 0007 (`web+stellar`) standard. dApps can generate deep links or QR codes that open directly inside the Lobstr mobile application or Lobstr web interface:

```typescript
/**
 * Generate a SEP-0007 URI for signing an unsigned transaction envelope in Lobstr.
 */
export function buildLobstrSigningUri(
  unsignedTxXdr: string,
  callbackUrl?: string
): string {
  const encodedXdr = encodeURIComponent(unsignedTxXdr);
  let uri = `web+stellar:tx?xdr=${encodedXdr}`;

  if (callbackUrl) {
    uri += `&callback=${encodeURIComponent(callbackUrl)}`;
  }

  return uri;
}
```

### Lobstr Web & Deep Link Flow

For mobile users, use deep link schemes to open the native app:

```typescript
export function openLobstrApp(unsignedTxXdr: string): void {
  const sep0007Uri = buildLobstrSigningUri(unsignedTxXdr);
  
  // Standard web+stellar protocol handler
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
    window.location.href = `lobstr://tx?xdr=${encodeURIComponent(unsignedTxXdr)}`;
  } else {
    // Fallback to web link or QR code modal
    window.open(`https://lobstr.co/sign?tx=${encodeURIComponent(unsignedTxXdr)}`, "_blank");
  }
}
```

---

## 4. Mapping Wallet Signatures to Observer Quorum

The `SettlementRegistry` Soroban contract validates that at least `quorum_threshold` independent observers have signed off on the settlement outcome before `finalize_case` executes.

### Quorum Verification Flow

```
+-----------------------------+
|    Observer 1 (Freighter)   | ----> Signs AuthEntry 1 (Base64 XDR)
+-----------------------------+
                                       \
+-----------------------------+         ---> Aggregated into Quorum Proof Payload
|    Observer 2 (Lobstr)      | ----> Signs AuthEntry 2 (Base64 XDR)
+-----------------------------+        /
                                      /
+-----------------------------+
|    Observer 3 (Freighter)   | ----> Signs AuthEntry 3 (Base64 XDR)
+-----------------------------+
                                      |
                                      v
                      +-------------------------------+
                      | StellarClear API / Contract   |
                      | verifyQuorum(signatures, 2/3) |
                      | Status: FINALIZED             |
                      +-------------------------------+
```

### Assembling the Finalization Payload

Using `@stellarclear/sdk`:

```typescript
import { SettlementClient } from "@stellarclear/sdk";

export async function submitFinalizationWithSignatures(
  client: SettlementClient,
  caseId: string,
  observerSignatures: Array<{ observer: string; signatureXdr: string }>
) {
  // Verify that required threshold is satisfied
  const caseData = await client.getCase(caseId);
  const minQuorum = caseData.quorumThreshold;

  if (observerSignatures.length < minQuorum) {
    throw new Error(
      `Insufficient quorum signatures: got ${observerSignatures.length}, required ${minQuorum}`
    );
  }

  // Submit finalized settlement case with aggregated attestations
  const txHash = await client.finalizeCase({
    caseId,
    attestations: observerSignatures.map((s) => ({
      signer: s.observer,
      signature: s.signatureXdr,
      role: "OBSERVER",
    })),
  });

  return txHash;
}
```

---

## 5. Security & Verification Best Practices

1. **Verify Network Passphrase**: Always verify `networkPassphrase` before asking users to sign. Testnet settlements must use `Test SDF Network ; September 2015`, whereas Mainnet requires `Public Global Stellar Network ; September 2015`.
2. **Deterministic Terms Hash**: Ensure the displayed case summary (amount, asset code, destination address) matches the hashed commitment digest in the Soroban authorization entry.
3. **Replay Protection**: Each auth entry contains a sequence number and contract invocation domain separator, preventing replay attacks across different settlement cases or networks.
4. **Hardware Wallet Support**: Users connecting Ledger devices via Freighter must ensure the Stellar Ledger app is updated and "Hash Signing" is enabled if signing complex Soroban contracts.
