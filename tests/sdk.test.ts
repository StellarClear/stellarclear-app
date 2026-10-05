import { Buffer } from "buffer";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StellarClearClient,
  SettlementRegistryClient,
  Networks,
  ValidationError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  normalizeContractError,
  breakCodeToContract,
  contractToBreakCode,
  attestationRoleToContract,
  contractToAttestationRole,
  decodeCaseRecord,
  decodeAttestationRecord,
  verifyObserverQuorum,
} from "@stellarclear/sdk";
import type { ExpectedSettlement, ObservedSettlement } from "@stellarclear/schemas";

const VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const VALID_ACCOUNT_ID = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEWBIXXX";
const VALID_CP_ID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_CASE_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_TX_HASH = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const SAMPLE_TERMS: ExpectedSettlement = {
  caseId: VALID_CASE_ID,
  tradeReference: "TR-100",
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  amount: "5000.0000000",
  expectedDestination: VALID_CP_ID,
  reference: "INV-100",
  deadline: 500000,
  owner: VALID_ACCOUNT_ID,
  counterparty: VALID_CP_ID,
};

const SAMPLE_OBSERVATION: ObservedSettlement = {
  txHash: VALID_TX_HASH,
  ledger: 499990,
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  amount: "5000.0000000",
  destination: VALID_CP_ID,
  reference: "INV-100",
  status: "SUCCESS",
  observedAt: "2026-09-29T12:00:00.000Z",
};

describe("SDK Package - Client Configuration & Creation", () => {
  it("initializes StellarClearClient with valid testnet configuration", () => {
    const client = new StellarClearClient({
      network: Networks.TESTNET.network,
      networkPassphrase: Networks.TESTNET.networkPassphrase,
      rpcUrl: Networks.TESTNET.rpcUrl,
      contractId: VALID_CONTRACT_ID,
    });

    assert.ok(client);
    assert.strictEqual(client.contractId, VALID_CONTRACT_ID);
    assert.strictEqual(client.network, "testnet");
    assert.strictEqual(client.networkPassphrase, "Test SDF Network ; September 2015");
    assert.ok(client.contractClient);
    assert.ok(client.rpcServer);
  });

  it("rejects invalid contract address (e.g. Account G... instead of Contract C...)", () => {
    assert.throws(() => {
      new StellarClearClient({
        network: "testnet",
        networkPassphrase: "Test SDF Network ; September 2015",
        rpcUrl: "https://soroban-testnet.stellar.org",
        contractId: VALID_ACCOUNT_ID,
      });
    });
  });

  it("provides generated SettlementRegistry binding methods", () => {
    const client = new StellarClearClient({
      network: Networks.TESTNET.network,
      networkPassphrase: Networks.TESTNET.networkPassphrase,
      rpcUrl: Networks.TESTNET.rpcUrl,
      contractId: VALID_CONTRACT_ID,
    });

    assert.strictEqual(typeof client.createCase, "function");
    assert.strictEqual(typeof client.recordObservation, "function");
    assert.strictEqual(typeof client.recordMatch, "function");
    assert.strictEqual(typeof client.recordBreak, "function");
    assert.strictEqual(typeof client.getCase, "function");
    assert.strictEqual(typeof client.isObserver, "function");
    assert.strictEqual(typeof client.submitAttestation, "function");
    assert.strictEqual(typeof client.openDispute, "function");
    assert.strictEqual(typeof client.submitResolution, "function");
    assert.strictEqual(typeof client.finalizeCase, "function");
  });
});

describe("SDK Package - Case Operations & Conversions", () => {
  const client = new StellarClearClient({
    network: Networks.TESTNET.network,
    networkPassphrase: Networks.TESTNET.networkPassphrase,
    rpcUrl: Networks.TESTNET.rpcUrl,
    contractId: VALID_CONTRACT_ID,
  });

  it("generates deterministic case IDs", () => {
    const id = client.generateCaseId(
      SAMPLE_TERMS.owner,
      SAMPLE_TERMS.tradeReference,
      SAMPLE_TERMS.asset,
      SAMPLE_TERMS.deadline
    );
    assert.strictEqual(id.length, 64);
    assert.strictEqual(
      id,
      client.generateCaseId(
        SAMPLE_TERMS.owner,
        SAMPLE_TERMS.tradeReference,
        SAMPLE_TERMS.asset,
        SAMPLE_TERMS.deadline
      )
    );
  });

  it("validates arguments when constructing case write calls", async () => {
    // Invalid terms (missing required fields)
    const invalidTerms = { ...SAMPLE_TERMS, amount: "invalid-amount" };
    await assert.rejects(async () => {
      await client.createCase(invalidTerms as unknown as ExpectedSettlement);
    });

    // Invalid observation (bad hash)
    const invalidObs = { ...SAMPLE_OBSERVATION, txHash: "short" };
    await assert.rejects(async () => {
      await client.recordObservation({
        observer: VALID_ACCOUNT_ID,
        caseId: VALID_CASE_ID,
        observation: invalidObs as unknown as ObservedSettlement,
      });
    });
  });

  it("converts break codes between domain and contract union tags", () => {
    const contractTag = breakCodeToContract("AMOUNT_MISMATCH");
    assert.strictEqual(contractTag.tag, "AmountMismatch");
    assert.strictEqual(contractToBreakCode(contractTag), "AMOUNT_MISMATCH");

    const failedTxTag = breakCodeToContract("FAILED_TRANSACTION");
    assert.strictEqual(failedTxTag.tag, "FailedTransaction");
    assert.strictEqual(contractToBreakCode(failedTxTag), "FAILED_TRANSACTION");
  });

  it("converts attestation roles between domain and contract union tags", () => {
    const roleTag = attestationRoleToContract("OWNER");
    assert.strictEqual(roleTag.tag, "Owner");
    assert.strictEqual(contractToAttestationRole(roleTag), "OWNER");

    const obsRoleTag = attestationRoleToContract("OBSERVER");
    assert.strictEqual(obsRoleTag.tag, "Observer");
    assert.strictEqual(contractToAttestationRole(obsRoleTag), "OBSERVER");
  });

  it("decodes raw Soroban SettlementCase records correctly", () => {
    const rawCase = {
      owner: VALID_ACCOUNT_ID,
      counterparty: VALID_CP_ID,
      terms_commitment: Buffer.from(VALID_CASE_ID, "hex"),
      expires_at_ledger: 500000,
      status: { tag: "Matched" as const, values: undefined },
      observation: {
        tag: "Observed" as const,
        values: [
          {
            tx_hash: Buffer.from(VALID_TX_HASH, "hex"),
            observation_commitment: Buffer.from(VALID_TX_HASH, "hex"),
            observed_ledger: 499990,
          },
        ] as const,
      },
      decision: { tag: "Matched" as const, values: undefined },
      created_at_ledger: 490000,
      finalized_at_ledger: undefined,
      observer_quorum: 1,
      dispute_expires_at_ledger: undefined,
    };

    const decoded = decodeCaseRecord(VALID_CASE_ID, rawCase);
    assert.strictEqual(decoded.caseId, VALID_CASE_ID);
    assert.strictEqual(decoded.owner, VALID_ACCOUNT_ID);
    assert.strictEqual(decoded.status, "MATCHED");
    assert.strictEqual(decoded.decision.type, "MATCHED");
    assert.ok(decoded.observation);
    if (decoded.observation) {
      assert.strictEqual(decoded.observation.txHash, VALID_TX_HASH);
      assert.strictEqual(decoded.observation.observedLedger, 499990);
    }
  });

  it("decodes raw Soroban Attestation records correctly", () => {
    const rawAtt = {
      role: { tag: "Owner" as const, values: undefined },
      commitment: Buffer.from(VALID_CASE_ID, "hex"),
      attested_at_ledger: 490010,
    };

    const decoded = decodeAttestationRecord(VALID_CASE_ID, VALID_ACCOUNT_ID, rawAtt);
    assert.strictEqual(decoded.caseId, VALID_CASE_ID);
    assert.strictEqual(decoded.attestor, VALID_ACCOUNT_ID);
    assert.strictEqual(decoded.role, "OWNER");
    assert.strictEqual(decoded.commitment, VALID_CASE_ID);
    assert.strictEqual(decoded.attestedAtLedger, 490010);
  });
});

describe("SDK Package - Error Normalization", () => {
  it("normalizes numeric contract error codes into typed domain errors", () => {
    const err1 = normalizeContractError({ code: 1, message: "Already initialized" });
    assert.ok(err1 instanceof ConflictError);

    const err2 = normalizeContractError({ code: 2, message: "Not found" });
    assert.ok(err2 instanceof NotFoundError);

    const err6 = normalizeContractError({ code: 6, message: "Unauthorized" });
    assert.ok(err6 instanceof UnauthorizedError);

    const err7 = normalizeContractError({ code: 7, message: "Invalid state" });
    assert.ok(err7 instanceof ValidationError);
  });

  it("normalizes simulation strings containing contract error codes", () => {
    const simErr = normalizeContractError(new Error("HostError: Error(Contract, #6)"));
    assert.ok(simErr instanceof UnauthorizedError);
  });
});

describe("SDK Package - SettlementRegistryClient Operations", () => {
  it("initializes SettlementRegistryClient and exposes registry operations", () => {
    const registryClient = new SettlementRegistryClient({
      network: Networks.TESTNET.network,
      networkPassphrase: Networks.TESTNET.networkPassphrase,
      rpcUrl: Networks.TESTNET.rpcUrl,
      contractId: VALID_CONTRACT_ID,
    });

    assert.ok(registryClient instanceof StellarClearClient);
    assert.strictEqual(typeof registryClient.createCase, "function");
    assert.strictEqual(typeof registryClient.recordObservation, "function");
    assert.strictEqual(typeof registryClient.recordMatch, "function");
    assert.strictEqual(typeof registryClient.recordBreak, "function");
    assert.strictEqual(typeof registryClient.submitAttestation, "function");
    assert.strictEqual(typeof registryClient.openDispute, "function");
    assert.strictEqual(typeof registryClient.submitResolution, "function");
    assert.strictEqual(typeof registryClient.finalizeCase, "function");
    assert.strictEqual(typeof registryClient.getCase, "function");
    assert.strictEqual(typeof registryClient.getAttestation, "function");
    assert.strictEqual(typeof registryClient.isObserver, "function");
    assert.strictEqual(typeof registryClient.getResolution, "function");
    assert.strictEqual(typeof registryClient.getLatestLedger, "function");
    assert.strictEqual(typeof registryClient.getCaseQuorum, "function");
    assert.strictEqual(typeof registryClient.setCaseQuorum, "function");
    assert.strictEqual(typeof registryClient.getAttestedObservers, "function");
    assert.strictEqual(typeof registryClient.submitObserverAttestation, "function");
    assert.strictEqual(typeof registryClient.verifyCaseQuorum, "function");
  });
});

describe("SDK Package - Observer Quorum Verification (TASK A)", () => {
  const OBSERVER_1 = "GA1111111111111111111111111111111111111111111111111111111111";
  const OBSERVER_2 = "GA2222222222222222222222222222222222222222222222222222222222";
  const OBSERVER_3 = "GA3333333333333333333333333333333333333333333333333333333333";

  it("verifies existing quorum-1 cases pass with a single distinct observer attestation", () => {
    const res = verifyObserverQuorum({
      caseId: VALID_CASE_ID,
      owner: VALID_ACCOUNT_ID,
      counterparty: VALID_CP_ID,
      requiredQuorum: 1,
      attestations: [
        { attestor: VALID_ACCOUNT_ID, role: "OWNER" },
        { attestor: OBSERVER_1, role: "OBSERVER" },
      ],
    });

    assert.strictEqual(res.requiredObserverQuorum, 1);
    assert.strictEqual(res.submittedObserverCount, 1);
    assert.strictEqual(res.distinctObserverCount, 1);
    assert.strictEqual(res.quorumSatisfied, true);
    assert.deepStrictEqual(res.distinctObservers, [OBSERVER_1]);
  });

  it("fails verification when a quorum-3 case has only two distinct observers", () => {
    const res = verifyObserverQuorum({
      caseId: VALID_CASE_ID,
      owner: VALID_ACCOUNT_ID,
      counterparty: VALID_CP_ID,
      requiredQuorum: 3,
      attestations: [
        { attestor: OBSERVER_1, role: "OBSERVER" },
        { attestor: OBSERVER_2, role: "OBSERVER" },
      ],
    });

    assert.strictEqual(res.requiredObserverQuorum, 3);
    assert.strictEqual(res.submittedObserverCount, 2);
    assert.strictEqual(res.distinctObserverCount, 2);
    assert.strictEqual(res.quorumSatisfied, false);
  });

  it("passes verification when a quorum-3 case has three distinct valid observers", () => {
    const res = verifyObserverQuorum({
      caseId: VALID_CASE_ID,
      owner: VALID_ACCOUNT_ID,
      counterparty: VALID_CP_ID,
      requiredQuorum: 3,
      attestations: [
        { attestor: OBSERVER_1, role: "OBSERVER" },
        { attestor: OBSERVER_2, role: "OBSERVER" },
        { attestor: OBSERVER_3, role: "OBSERVER" },
      ],
    });

    assert.strictEqual(res.requiredObserverQuorum, 3);
    assert.strictEqual(res.submittedObserverCount, 3);
    assert.strictEqual(res.distinctObserverCount, 3);
    assert.strictEqual(res.quorumSatisfied, true);
  });

  it("counts duplicate observer submissions only once", () => {
    const res = verifyObserverQuorum({
      caseId: VALID_CASE_ID,
      owner: VALID_ACCOUNT_ID,
      counterparty: VALID_CP_ID,
      requiredQuorum: 2,
      attestations: [
        { attestor: OBSERVER_1, role: "OBSERVER" },
        { attestor: OBSERVER_1, role: "OBSERVER" }, // duplicate submission
        { attestor: OBSERVER_1, role: "OBSERVER" }, // duplicate submission
      ],
    });

    assert.strictEqual(res.requiredObserverQuorum, 2);
    assert.strictEqual(res.submittedObserverCount, 3);
    assert.strictEqual(res.distinctObserverCount, 1);
    assert.strictEqual(res.quorumSatisfied, false); // requires 2 distinct, only 1 provided
  });

  it("strictly excludes owner and counterparty attestations from observer quorum", () => {
    const res = verifyObserverQuorum({
      caseId: VALID_CASE_ID,
      owner: VALID_ACCOUNT_ID,
      counterparty: VALID_CP_ID,
      requiredQuorum: 2,
      attestations: [
        { attestor: VALID_ACCOUNT_ID, role: "OBSERVER" }, // Owner trying to masquerade as observer
        { attestor: VALID_CP_ID, role: "OBSERVER" },      // Counterparty trying to masquerade
        { attestor: OBSERVER_1, role: "OBSERVER" },
      ],
    });

    assert.strictEqual(res.requiredObserverQuorum, 2);
    // Only OBSERVER_1 is valid (owner and CP excluded)
    assert.strictEqual(res.distinctObserverCount, 1);
    assert.strictEqual(res.quorumSatisfied, false);
    assert.deepStrictEqual(res.distinctObservers, [OBSERVER_1]);
  });
});
