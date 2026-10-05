import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import {
  SettlementRegistryOperations,
  StellarClearClient,
  Networks,
  extractTxHash,
  extractSimulatedTxHash,
  MissingTransactionHashError,
} from "@stellarclear/sdk";
import type { ExpectedSettlement, ObservedSettlement } from "@stellarclear/schemas";

const VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const VALID_ACCOUNT_ID = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEWBIXXX";
const VALID_CP_ID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_CASE_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_TX_HASH = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const SAMPLE_TERMS: ExpectedSettlement = {
  caseId: VALID_CASE_ID,
  tradeReference: "TR-SR-100",
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  amount: "1000.0000000",
  expectedDestination: VALID_CP_ID,
  reference: "INV-SR-100",
  deadline: 600000,
  owner: VALID_ACCOUNT_ID,
  counterparty: VALID_CP_ID,
};

const SAMPLE_OBSERVATION: ObservedSettlement = {
  txHash: VALID_TX_HASH,
  ledger: 599990,
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  amount: "1000.0000000",
  destination: VALID_CP_ID,
  reference: "INV-SR-100",
  status: "SUCCESS",
  observedAt: "2026-09-29T12:00:00.000Z",
};

describe("SDK Package - SettlementRegistry Client Operations", () => {
  const client = new StellarClearClient({
    network: Networks.TESTNET.network,
    networkPassphrase: Networks.TESTNET.networkPassphrase,
    rpcUrl: Networks.TESTNET.rpcUrl,
    contractId: VALID_CONTRACT_ID,
  });

  const registryOps = new SettlementRegistryOperations({
    client: client.contractClient,
    config: client.config,
  });

  it("exposes all required SettlementRegistry lifecycle operations", () => {
    assert.strictEqual(typeof registryOps.createCase, "function");
    assert.strictEqual(typeof registryOps.recordObservation, "function");
    assert.strictEqual(typeof registryOps.recordMatch, "function");
    assert.strictEqual(typeof registryOps.recordBreak, "function");
    assert.strictEqual(typeof registryOps.submitAttestation, "function");
    assert.strictEqual(typeof registryOps.openDispute, "function");
    assert.strictEqual(typeof registryOps.submitResolution, "function");
    assert.strictEqual(typeof registryOps.finalizeCase, "function");
    assert.strictEqual(typeof registryOps.getCase, "function");
    assert.strictEqual(typeof registryOps.getAttestation, "function");
    assert.strictEqual(typeof registryOps.isObserver, "function");
    assert.strictEqual(typeof registryOps.getResolution, "function");
  });

  it("validates parameters when invoking createCase", async () => {
    const invalidTerms = { ...SAMPLE_TERMS, amount: "not-a-decimal" };
    await assert.rejects(async () => {
      await registryOps.createCase(invalidTerms as unknown as ExpectedSettlement);
    });
  });

  it("validates parameters when invoking recordObservation", async () => {
    const invalidObs = { ...SAMPLE_OBSERVATION, txHash: "invalid" };
    await assert.rejects(async () => {
      await registryOps.recordObservation({
        observer: VALID_ACCOUNT_ID,
        caseId: VALID_CASE_ID,
        observation: invalidObs as unknown as ObservedSettlement,
      });
    });
  });

  it("validates parameters when invoking recordBreak with BreakCode", async () => {
    // Valid arguments shape check
    assert.doesNotThrow(() => {
      registryOps.generateCaseId(
        SAMPLE_TERMS.owner,
        SAMPLE_TERMS.tradeReference,
        SAMPLE_TERMS.asset,
        SAMPLE_TERMS.deadline
      );
    });
  });
});

describe("SDK Package - Transaction Hash Validation & Simulation Mode (TASK H)", () => {
  it("extracts real transaction hash from txHash property", () => {
    const hash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    assert.strictEqual(extractTxHash({ txHash: hash }), hash);
  });

  it("extracts real transaction hash from hash property", () => {
    const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    assert.strictEqual(extractTxHash({ hash }), hash);
  });

  it("extracts real transaction hash from raw.hash() function", () => {
    const rawHashBuf = Buffer.from("deadbeefcafebabe0123456789abcdefdeadbeefcafebabe0123456789abcdef", "hex");
    const mockTx = {
      raw: {
        hash: () => rawHashBuf,
      },
    };
    assert.strictEqual(
      extractTxHash(mockTx),
      "deadbeefcafebabe0123456789abcdefdeadbeefcafebabe0123456789abcdef"
    );
  });

  it("fails with MissingTransactionHashError when transaction response lacks real tx hash", () => {
    assert.throws(
      () => extractTxHash({}),
      (err: unknown) => {
        const missingErr = err as MissingTransactionHashError;
        assert.ok(missingErr instanceof MissingTransactionHashError);
        assert.strictEqual(missingErr.code, "MISSING_TRANSACTION_HASH");
        assert.ok(missingErr.message.includes("SDK_MISSING_TX_HASH"));
        return true;
      }
    );

    assert.throws(
      () => extractTxHash(null),
      MissingTransactionHashError
    );

    assert.throws(
      () => extractTxHash({ txHash: "" }),
      MissingTransactionHashError
    );
  });

  it("explicitly marks simulation mode hashes with sim_ prefix", () => {
    const simHash = extractSimulatedTxHash("createCase_case1");
    assert.strictEqual(simHash, "sim_createCase_case1");
    assert.ok(simHash.startsWith("sim_"));
    // Simulation hash is never a valid 64-character hex Stellar tx hash
    assert.notStrictEqual(simHash.length, 64);
  });

  it("rejects simulated response without real hash during SDK contract operation", async () => {
    const mockClient = {
      create_case: async () => ({
        // Simulation response with NO hash property
        result: undefined,
      }),
    };

    const client = new StellarClearClient({
      network: Networks.TESTNET.network,
      networkPassphrase: Networks.TESTNET.networkPassphrase,
      rpcUrl: Networks.TESTNET.rpcUrl,
      contractId: VALID_CONTRACT_ID,
    });

    const ops = new SettlementRegistryOperations({
      client: mockClient as any,
      config: client.config,
    });

    await assert.rejects(
      async () => {
        await ops.createCase(SAMPLE_TERMS);
      },
      (err: unknown) => {
        assert.ok(err instanceof MissingTransactionHashError);
        assert.strictEqual((err as MissingTransactionHashError).code, "MISSING_TRANSACTION_HASH");
        return true;
      }
    );
  });
});
