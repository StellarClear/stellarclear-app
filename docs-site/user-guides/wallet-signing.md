# Wallet Signing Integration Guide (Freighter & Lobstr)

StellarClear enables non-custodial, cryptographically verified settlement reconciliation for counterparties and independent observers on Stellar and Soroban.

This guide provides end-to-end instructions, code snippets, and architectural details on how to integrate **Freighter** (browser extension) and **Lobstr** (mobile/web) wallets to sign settlement commitments and observer attestations directly in decentralized applications.

---

## 1. Overview & Trust Model

In StellarClear's non-custodial model:
- **Private keys never leave the user's custody**: Settlement terms, observations, and attestations are signed client-side via hardware wallets or browser/mobile signer extensions.
- **Soroban Authorization Entries**: In Soroban smart contracts, function invocations that require multi-party consent (such as `create_case`, `submit_attestation`, and `finalize_case`) consume standard `SorobanAuthorizationEntry` credentials signed by the wallet's keypair.
- **M-of-N Observer Quorum**: Independent observer attestations signed via Freighter or Lobstr are aggregated into batched payloads, satisfying the decentralized quorum threshold configured on the `SettlementRegistry` contract.

```
+---------------------------------------------------------------------------------+
|                                 Client Application                              |
|                                                                                 |
|   1. Generate Commitment Digest ----> 2. Request Signature                     |
|                                                  |                              |
|                                      +-----------v-----------+                  |
|                                      |   Wallet Connector    |                  |
|                                      | (Freighter / Lobstr)  |                  |
|                                      +-----------+-----------+                  |
|                                                  |                              |
|   4. Submit Attestation / Case <----- 3. User Approves & Returns                |
|      (with signature / auth entry)       Signed XDR / Digest                    |
+--------------------------------------------------+------------------------------+
                                                   |
                                                   v
                          +-----------------------------------------------+
                          |   Soroban Smart Contract (SettlementRegistry)  |
                          |   - Verifies Ed25519 / Auth Entry Signature   |
                          |   - Validates M-of-N Observer Quorum          |
                          |   - Anchors Immutable Settlement State        |
                          +-----------------------------------------------+
```

---

## 2. Freighter Wallet Integration

[Freighter](https://www.freighter.app/) is the standard browser extension wallet developed by the Stellar Development Foundation (SDF) supporting classic Stellar transactions and Soroban smart contract authorization entries.

### Installation

Install the official client SDK via npm or yarn:

```bash
npm install @stellar/freighter-api
```

### Complete Freighter Integration Example

```typescript
import {
  isConnected,
  requestAccess,
  getPublicKey,
  getNetworkDetails,
  signTransaction,
  signAuthEntry,
} from "@stellar/freighter-api";

export class FreighterWalletConnector {
  /**
   * Checks whether the Freighter extension is installed and available in the browser.
   */
  public async isAvailable(): Promise<boolean> {
    const result = await isConnected();
    return Boolean(result && result.isConnected);
  }

  /**
   * Prompts the user to grant access and returns their active public key (G...).
   */
  public async connect(): Promise<string> {
    const accessGranted = await requestAccess();
    if (!accessGranted || accessGranted.error) {
      throw new Error(`Freighter access rejected: ${accessGranted?.error ?? "User denied"}`);
    }

    const { publicKey } = await getPublicKey();
    if (!publicKey) {
      throw new Error("Unable to retrieve public key from Freighter");
    }

    return publicKey;
  }

  /**
   * Signs a prepared Soroban settlement transaction envelope.
   *
   * @param transactionXdr Base64-encoded Stellar TransactionEnvelope XDR
   * @param networkPassphrase Network identifier (e.g. Test SDF Network ; September 2015)
   * @returns Signed TransactionEnvelope XDR
   */
  public async signSettlementTransaction(
    transactionXdr: string,
    networkPassphrase = "Test SDF Network ; September 2015"
  ): Promise<string> {
    const signedResult = await signTransaction(transactionXdr, {
      networkPassphrase,
    });

    if (!signedResult || signedResult.error) {
      throw new Error(`Transaction signing failed: ${signedResult?.error ?? "Unknown error"}`);
    }

    return signedResult.signedTxXdr;
  }

  /**
   * Signs an individual Soroban Authorization Entry (SorobanAuthorizationEntry).
   * Used for multi-party attestation and observer quorum batching.
   *
   * @param entryXdr Base64-encoded SorobanAuthorizationEntry XDR
   * @param networkPassphrase Network identifier
   * @returns Signed SorobanAuthorizationEntry XDR
   */
  public async signSorobanAuthEntry(
    entryXdr: string,
    networkPassphrase = "Test SDF Network ; September 2015"
  ): Promise<string> {
    const result = await signAuthEntry(entryXdr, {
      networkPassphrase,
    });

    if (!result || result.error) {
      throw new Error(`Auth entry signing failed: ${result?.error ?? "Unknown error"}`);
    }

    return result.signedAuthEntry;
  }
}
```

---

## 3. Lobstr Wallet Integration

[Lobstr](https://lobstr.co/) is a leading consumer and institutional Stellar wallet offering mobile (iOS/Android) and web interfaces with WalletConnect v2 integration.

### Connection Architecture via WalletConnect v2

To connect Lobstr from a web dApp, use `@walletconnect/sign-client`:

```bash
npm install @walletconnect/sign-client @stellar/stellar-sdk
```

### Lobstr Client Example

```typescript
import SignClient from "@walletconnect/sign-client";
import { Keypair, Transaction, Networks } from "@stellar/stellar-sdk";

export class LobstrWalletConnector {
  private client?: SignClient;
  private sessionTopic?: string;

  /**
   * Initializes the WalletConnect v2 client for Stellar mainnet or testnet.
   */
  public async init(projectId: string): Promise<void> {
    this.client = await SignClient.init({
      projectId,
      metadata: {
        name: "StellarClear Settlement Portal",
        description: "Decentralized Settlement Evidence Protocol",
        url: "https://stellarclear.org",
        icons: ["https://stellarclear.org/icon.png"],
      },
    });
  }

  /**
   * Establishes a session with Lobstr by displaying a QR code or opening a deep link.
   */
  public async connect(onUri: (uri: string) => void): Promise<string> {
    if (!this.client) throw new Error("WalletConnect not initialized");

    const { uri, approval } = await this.client.connect({
      requiredNamespaces: {
        stellar: {
          methods: ["stellar_signTransaction", "stellar_signXDR"],
          chains: ["stellar:testnet"],
          events: [],
        },
      },
    });

    if (uri) {
      // Surface URI to user as QR code (mobile Lobstr) or deep link (lobstr://...)
      onUri(uri);
    }

    const session = await approval();
    this.sessionTopic = session.topic;

    // Extract connected account (format: stellar:testnet:G...)
    const fullAccount = session.namespaces.stellar.accounts[0];
    const publicKey = fullAccount.split(":")[2];
    return publicKey;
  }

  /**
   * Requests Lobstr to sign a settlement transaction.
   */
  public async signTransaction(xdr: string): Promise<string> {
    if (!this.client || !this.sessionTopic) {
      throw new Error("No active Lobstr session");
    }

    const result = await this.client.request<{ signedXDR: string }>({
      topic: this.sessionTopic,
      chainId: "stellar:testnet",
      request: {
        method: "stellar_signTransaction",
        params: { xdr },
      },
    });

    return result.signedXDR;
  }
}
```

---

## 4. Mapping Wallet Signatures to Soroban & M-of-N Quorum

When users and independent observers sign settlement operations, their signatures map to protocol primitives:

### A. Soroban Authorization Entries (`SorobanAuthorizationEntry`)
When invoking state-transition methods like `submit_attestation` or `finalize_case`:
1. The dApp builds the Soroban transaction with an authorization entry requiring the observer or owner address.
2. The authorization entry contains the contract ID, method name, args digest, nonce, and validity period.
3. The wallet signs the entry via `signAuthEntry()` (Freighter) or transaction signature.
4. Soroban validates that the cryptographic signature matches the authorized public key stored in `SettlementRegistry`.

### B. M-of-N Observer Quorum Aggregation
For settlement cases requiring multi-party verification (e.g., $M = 2$ out of $N = 3$ authorized observers):
1. Each observer node connects their Freighter or Lobstr wallet.
2. The observer signs an attestation commitment:
   $$\text{commitment} = \text{SHA-256}(\text{observed\_tx\_hash} \parallel \text{terms\_commitment})$$
3. The signed attestations are submitted to the `@stellarclear/sdk` `ObserverSignatureAggregator`.
4. Once quorum threshold ($M$) is reached with distinct authorized observers, `toFinalizationPayload()` produces the batch execution payload for on-chain settlement finalization.

---

## 5. Security & Best Practices

1. **Strict Origin Checking**: Never accept signatures generated from unauthorized RPC endpoints or untrusted networks. Always match `networkPassphrase` against `Networks.TESTNET` or `Networks.PUBLIC`.
2. **Replay Protection**: All Soroban contract calls incorporate an on-chain sequential nonce for authorization entries, preventing signature replays across ledgers.
3. **No Secret Key Storage**: DApps should never prompt users for secret seed keys (`S...`). All signing must route exclusively through Freighter, Lobstr, or hardware signers (Ledger).
4. **Deterministic Digest Verification**: Before presenting a transaction to Freighter or Lobstr for signing, verify that the `termsCommitment` and `caseId` match the canonical trade specification.

---

## 6. Next Steps & Resources

- [TypeScript SDK Integration Guide](/developer-guide/sdk)
- [Settlement Proofs & Attestations](/protocol-concepts/proofs-and-attestations)
- [Independent Observer Guide](/user-guides/independent-observer)
- [Official Freighter Documentation](https://docs.freighter.app/)
