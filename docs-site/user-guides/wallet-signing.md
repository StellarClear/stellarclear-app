# Wallet Signing Integration Guide

This guide provides end-to-end instructions for integrating non-custodial browser and mobile wallets into the StellarClear settlement verification workflow. It covers **Freighter** (browser extension) and **Lobstr** (mobile/web signer), demonstrating how to request account access, sign standard transactions, sign Soroban authorization entries, and fulfill M-of-N observer quorum attestations.

---

## 1. Overview & Architecture

StellarClear relies on cryptographic signatures from participants (Case Owners, Counterparties, and Independent Observers) to anchor evidentiary commitments and seal settlements on-chain.

```text
  User (Observer)           StellarClear dApp               Freighter / Lobstr           Soroban RPC (Registry)
         │                          │                                │                              │
         │─── Initiate Action ─────►│                                │                              │
         │                          │─── requestAccess() ───────────►│                              │
         │                          │◄── Return Address (G...) ──────│                              │
         │                          │─── Simulate Invocation ──────────────────────────────────────►│
         │                          │◄── Auth Entry XDR ────────────────────────────────────────────│
         │                          │─── signAuthEntry() ───────────►│                              │
         │                          │                                │ (Prompt User)                │
         │                          │◄── Signed Auth Entry XDR ──────│                              │
         │                          │─── submitTransaction() ──────────────────────────────────────►│
         │                          │◄── State Transition: MATCHED -> FINALIZED ────────────────────│
         │◄── Confirmation ─────────│
```

### Supported Wallets

| Wallet | Target Environment | Primary Protocol | Key Features |
| :--- | :--- | :--- | :--- |
| **Freighter** | Desktop Browsers (Chrome, Brave, Edge, Firefox) | Native Extension API (`@stellar/freighter-api`) | Direct Soroban Auth Entry signing, hardware wallet support, instant popup approval |
| **Lobstr** | iOS, Android, Web | WalletConnect v2 & SEP-0007 | Push notification signature requests, multisig vault integration, mobile-friendly signing |

---

## 2. Freighter Wallet Integration

Freighter (and its Varial update) is the primary developer and institutional browser extension wallet for Stellar and Soroban.

### Installation & Setup

Install the official browser extension from [freighter.app](https://www.freighter.app/) or via npm for your application:

```bash
npm install @stellar/freighter-api
```

### Step 1: Detect Extension & Request Account Access

Before triggering transactions, verify that Freighter is installed and request the user's public address:

```typescript
import {
  isConnected,
  isAllowed,
  setAllowed,
  requestAccess,
  getAddress,
  getNetworkDetails,
} from "@stellar/freighter-api";

export async function connectFreighter(): Promise<string> {
  // 1. Check if the extension is installed
  const installed = await isConnected();
  if (!installed) {
    throw new Error(
      "Freighter wallet extension is not installed. Please install it from https://www.freighter.app"
    );
  }

  // 2. Request user authorization to connect
  const accessObj = await requestAccess();
  if (accessObj.error) {
    throw new Error(`Freighter connection rejected: ${accessObj.error}`);
  }

  // 3. Retrieve public key
  const userAddress = accessObj.address || (await getAddress()).address;
  if (!userAddress) {
    throw new Error("Unable to retrieve public key from Freighter.");
  }

  // 4. Validate network (ensure user is on the expected network, e.g., Testnet)
  const network = await getNetworkDetails();
  console.log(`Connected to ${network.network} (Passphrase: ${network.networkPassphrase})`);

  return userAddress;
}
```

---

### Step 2: Sign a Standard Stellar Transaction Envelope

When submitting classic ledger operations or wrapping envelopes:

```typescript
import { signTransaction } from "@stellar/freighter-api";

export async function signSettlementEnvelope(
  xdrEnvelope: string,
  networkPassphrase: string = "Test SDF Network ; September 2015"
): Promise<string> {
  const result = await signTransaction(xdrEnvelope, {
    networkPassphrase,
  });

  if (result.error) {
    throw new Error(`Transaction signing failed: ${result.error}`);
  }

  return result.signedTxXdr;
}
```

---

### Step 3: Sign Soroban Authorization Entries (`signAuthEntry`)

Soroban smart contracts utilize scoped authorization entries (`SorobanAuthorizationEntry`) rather than requiring a full transaction signature for every invocation. This allows granular permissions (e.g., signing only an observer attestation payload without exposing full account authority).

```typescript
import { signAuthEntry } from "@stellar/freighter-api";

export interface ObserverAttestationPayload {
  caseId: string;
  observerAddress: string;
  preimageHashHex: string;
  authEntryXdr: string;
}

/**
 * Signs a Soroban authorization entry for independent observer attestation.
 */
export async function signObserverAuthEntry(
  authEntryXdr: string,
  networkPassphrase: string = "Test SDF Network ; September 2015"
): Promise<string> {
  const authResult = await signAuthEntry(authEntryXdr, {
    networkPassphrase,
  });

  if (authResult.error) {
    throw new Error(`Soroban auth entry signing declined: ${authResult.error}`);
  }

  // Returns the signed Soroban authorization entry XDR containing the cryptographic signature
  return authResult.signedAuthEntryXdr;
}
```

---

## 3. Lobstr Wallet Integration

Lobstr provides mobile-first custody and multi-signature security for institutional counterparties and dispute arbitrators.

### Connection Architecture via StellarWalletsKit / WalletConnect

For browser dApps supporting Lobstr, integrate `@creit.tech/stellar-wallets-kit`:

```bash
npm install @creit.tech/stellar-wallets-kit
```

### Implementing Lobstr Signer Workflow

```typescript
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  LOBSTR_ID,
} from "@creit.tech/stellar-wallets-kit";

// Initialize multi-wallet kit
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: LOBSTR_ID,
  modules: allowAllModules(),
});

export async function connectLobstr(): Promise<string> {
  // Open Lobstr connection modal (or QR code for mobile app)
  await kit.openModal({
    onWalletSelected: async (option) => {
      kit.setWallet(option.id);
    },
  });

  const { address } = await kit.getAddress();
  return address;
}

export async function signWithLobstr(xdr: string): Promise<string> {
  const { signedXDR } = await kit.sign({
    xdr,
    network: WalletNetwork.TESTNET,
  });
  return signedXDR;
}
```

### Lobstr Mobile Signing Flow:
1. The web dApp renders a **WalletConnect QR Code** or deep link.
2. The user scans the QR code using the **Lobstr Mobile App** on iOS or Android.
3. Lobstr displays the transaction summary: contract address, invoked function (`submit_attestation`), and arguments.
4. The user verifies biometric authentication (FaceID/Fingerprint) and approves the signature.
5. The signed XDR is relayed back over WebSocket to the StellarClear web client.

---

## 4. Soroban Authorization Entries & M-of-N Observer Quorum

StellarClear's Soroban contract (`SettlementRegistry`) requires independent observer attestations to fulfill an **M-of-N threshold quorum** before disputed or high-value cases can be finalized.

### How Signatures Map to On-Chain Quorum:

1. **Observer Authorization**:
   Each registered observer holds a whitelisted Stellar public key (`G...`). When observing a matched settlement break or agreement, the observer signs an attestation preimage:
   $$\text{AttestationHash} = \text{SHA-256}(\text{caseId} \parallel \text{role} \parallel \text{outcome} \parallel \text{nonce})$$

2. **Soroban Scoped Authorization**:
   The signature is packaged inside a Soroban `AddressCredentials` struct:
   ```rust
   pub struct SorobanAuthorizationEntry {
       pub credentials: AddressCredentials,
       pub root_invocation: AuthorizedInvocation,
   }
   ```

3. **M-of-N Evaluation**:
   When `finalize_with_attestations` is called:
   * The contract checks each signature against the whitelisted observer public keys.
   * Duplicate signatures from the same observer are rejected.
   * If $\text{validSignatures} \ge M$ (where $M \le N$), the case state transitions from `OPEN` / `DISPUTED` to `FINALIZED`.

```typescript
import { signObserverAuthEntry } from "./wallet";

export async function assembleQuorumAttestation(
  caseId: string,
  observerAddress: string,
  authEntryXdr: string
) {
  // Step 1: Sign auth entry with observer wallet
  const signedAuthXdr = await signObserverAuthEntry(authEntryXdr);

  // Step 2: Post signed attestation to StellarClear REST API
  const response = await fetch(`/v1/cases/${caseId}/attestations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "OBSERVER",
      signer: observerAddress,
      signedAuthEntryXdr: signedAuthXdr,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(`Attestation submission failed: ${errorBody.message}`);
  }

  return await response.json();
}
```

---

## 5. Error Handling & Edge Cases

When integrating wallet signers, client applications must handle transient errors and user cancellations gracefully:

| Error Code / Scenario | Cause | Remediation |
| :--- | :--- | :--- |
| `UserDeclinedError` | User clicked "Reject" in the Freighter popup or dismissed Lobstr prompt. | Catch error, inform user that signature is required to proceed, and do not mutate local case state. |
| `NetworkMismatchError` | Wallet is set to `PUBLIC` (Mainnet) while contract is deployed on `TESTNET`. | Call `getNetworkDetails()` and prompt user to switch Freighter network to Testnet. |
| `AccountNotFundedError` | The wallet address is fresh and has not been funded with minimum XLM reserve. | Direct user to [Stellar Friendbot](https://laboratory.stellar.org/#account-creator) to fund account. |
| `AuthEntryExpiredError` | Ledger sequence boundary for Soroban authorization entry elapsed before submission. | Re-simulate invocation on Soroban RPC and generate fresh auth entry XDR for signing. |

### Sample Defensive Wrapper:

```typescript
export async function safeWalletExecute<T>(action: () => Promise<T>): Promise<T | null> {
  try {
    return await action();
  } catch (error: any) {
    if (error?.message?.includes("User declined") || error?.message?.includes("rejected")) {
      console.warn("User canceled signing transaction.");
      return null;
    }
    if (error?.message?.includes("Network mismatch")) {
      alert("Please switch your wallet to Stellar Testnet before continuing.");
      return null;
    }
    console.error("Unhandled wallet signing error:", error);
    throw error;
  }
}
```

---

## 6. Next Steps & Resources

* [Case Owner User Guide](./case-owner.md) &mdash; Register bilateral settlement terms.
* [Independent Observer Guide](./independent-observer.md) &mdash; Observer attestation criteria and responsibilities.
* [Smart Contract Reference](../reference/contract.md) &mdash; Soroban `SettlementRegistry` specification.
* [Freighter API Documentation](https://docs.freighter.app/) &mdash; Official Freighter developer reference.
