import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupLiveSettlementEnvironment } from "./helpers/soroban.js";
import { computeTermsCommitment, computeObservationCommitment } from "@stellarclear/proof";
import type {
  ExpectedSettlement,
  ObservedSettlement,
  SettlementProof,
} from "@stellarclear/schemas";

describe("Live Integration - Full Settlement Lifecycles on Soroban", () => {
  it("executes Flow A: Complete successful match lifecycle with live contract state", async () => {
    const { caseRepo, soroban, server } = setupLiveSettlementEnvironment();

    const terms: ExpectedSettlement = {
      caseId: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TRADE-LIVE-FLOW-A",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "500000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-FLOW-A-001",
      deadline: 1600000,
    };

    const observed: ObservedSettlement = {
      txHash: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
      ledger: 1550000,
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "500000.00",
      destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-FLOW-A-001",
      status: "SUCCESS",
      observedAt: "2026-09-29T14:00:00.000Z",
    };

    // 1. Create Case
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });
    assert.strictEqual(createRes.statusCode, 201);
    const createBody = createRes.body as { txHash?: string };
    assert.ok(createBody.txHash);

    // Verify on-chain state
    const onchainAfterCreate = await soroban.getOnChainCase(terms.caseId);
    if (!onchainAfterCreate) throw new Error("Expected onchainAfterCreate to exist");
    assert.strictEqual(onchainAfterCreate.status, "OPEN");
    assert.strictEqual(onchainAfterCreate.termsCommitment, computeTermsCommitment(terms));

    // 2. Observe Settlement
    const obsRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/observe`,
      body: { observation: observed },
    });
    assert.strictEqual(obsRes.statusCode, 200);

    const onchainAfterObs = await soroban.getOnChainCase(terms.caseId);
    if (!onchainAfterObs) throw new Error("Expected onchainAfterObs to exist");
    assert.strictEqual(onchainAfterObs.status, "OBSERVED");
    assert.strictEqual(
      onchainAfterObs.observation?.observationCommitment,
      computeObservationCommitment(observed)
    );

    // 3. Reconcile Settlement
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { matched: boolean };
    assert.strictEqual(recBody.matched, true);

    const onchainAfterRec = await soroban.getOnChainCase(terms.caseId);
    if (!onchainAfterRec) throw new Error("Expected onchainAfterRec to exist");
    assert.strictEqual(onchainAfterRec.status, "MATCHED");
    assert.strictEqual(onchainAfterRec.decision.type, "MATCHED");

    // 4. Attest
    const attestRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/attest`,
      body: {
        role: "OWNER",
        attestor: terms.owner,
        commitment: computeTermsCommitment(terms),
      },
    });
    assert.strictEqual(attestRes.statusCode, 201);

    const onchainAttest = await soroban.getOnChainAttestation(terms.caseId, terms.owner);
    if (!onchainAttest) throw new Error("Expected onchainAttest to exist");
    assert.strictEqual(onchainAttest.role, "OWNER");

    // 5. Generate and Verify Proof
    const proofRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${terms.caseId}/proof`,
    });
    assert.strictEqual(proofRes.statusCode, 200);
    const proof = proofRes.body as SettlementProof;

    const verifyRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify",
      body: { proof },
    });
    assert.strictEqual(verifyRes.statusCode, 200);
    const verifyBody = verifyRes.body as { valid: boolean };
    assert.strictEqual(verifyBody.valid, true);

    const verifyOnchainRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify/onchain",
      body: { proof },
    });
    assert.strictEqual(verifyOnchainRes.statusCode, 200);
    const verifyOnchainBody = verifyOnchainRes.body as { valid: boolean };
    assert.strictEqual(verifyOnchainBody.valid, true);

    // 6. Finalize Case
    const finalizeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/finalize`,
    });
    assert.strictEqual(finalizeRes.statusCode, 200);

    const onchainFinal = await soroban.getOnChainCase(terms.caseId);
    if (!onchainFinal) throw new Error("Expected onchainFinal to exist");
    assert.strictEqual(onchainFinal.status, "FINALIZED");

    // Verify DB state
    const dbCase = await caseRepo.findById(terms.caseId, "testnet");
    if (!dbCase) throw new Error("Expected dbCase to exist");
    assert.strictEqual(dbCase.status, "FINALIZED");
    assert.ok(dbCase.create_tx_hash);
    assert.ok(dbCase.observation_tx_hash);
    assert.ok(dbCase.reconciliation_tx_hash);
    assert.ok(dbCase.attestation_tx_hash);
    assert.ok(dbCase.finalization_tx_hash);
  });

  it("executes Flow B: Complete break and dispute resolution lifecycle with live contract state", async () => {
    const { caseRepo, soroban, server } = setupLiveSettlementEnvironment();

    const terms: ExpectedSettlement = {
      caseId: "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TRADE-LIVE-FLOW-B",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "100000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-FLOW-B-001",
      deadline: 1600000,
    };

    // Mismatched amount
    const observed: ObservedSettlement = {
      txHash: "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
      ledger: 1550000,
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "95000.00",
      destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-FLOW-B-001",
      status: "SUCCESS",
      observedAt: "2026-09-29T14:30:00.000Z",
    };

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // 2. Observe Settlement
    await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/observe`,
      body: { observation: observed },
    });

    // 3. Reconcile -> Break
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { matched: boolean; status: string };
    assert.strictEqual(recBody.matched, false);
    assert.strictEqual(recBody.status, "BREAK");

    const onchainBreak = await soroban.getOnChainCase(terms.caseId);
    if (!onchainBreak) throw new Error("Expected onchainBreak to exist");
    assert.strictEqual(onchainBreak.status, "BREAK");

    // 4. Open Dispute
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/dispute`,
      body: {
        initiator: terms.owner,
        reason: "Observed settlement amount 95000.00 does not match expected 100000.00",
      },
    });
    assert.strictEqual(disputeRes.statusCode, 201);

    const onchainDispute = await soroban.getOnChainCase(terms.caseId);
    if (!onchainDispute) throw new Error("Expected onchainDispute to exist");
    assert.strictEqual(onchainDispute.status, "DISPUTED");

    // 5. Submit Resolution (Both counterparty and owner submit matching resolution)
    const counterparty = terms.counterparty ?? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const resolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver: counterparty,
        resolutionType: "ACCEPT_PARTIAL",
        agreedAmount: "95000.00",
        resolutionCommitment: "f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6",
      },
    });
    assert.strictEqual(resolveRes.statusCode, 200);

    const ownerResolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver: terms.owner,
        resolutionType: "ACCEPT_PARTIAL",
        agreedAmount: "95000.00",
        resolutionCommitment: "f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6",
      },
    });
    assert.strictEqual(ownerResolveRes.statusCode, 200);

    const onchainResolve = await soroban.getOnChainCase(terms.caseId);
    if (!onchainResolve) throw new Error("Expected onchainResolve to exist");
    assert.strictEqual(onchainResolve.status, "RESOLVED");

    // 6. Generate Proof & Verify
    const proofRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${terms.caseId}/proof`,
    });
    assert.strictEqual(proofRes.statusCode, 200);
    const proof = proofRes.body as SettlementProof;

    const verifyRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify",
      body: { proof },
    });
    assert.strictEqual(verifyRes.statusCode, 200);
    const verifyBody = verifyRes.body as { valid: boolean };
    assert.strictEqual(verifyBody.valid, true);

    const verifyOnchainRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify/onchain",
      body: { proof },
    });
    assert.strictEqual(verifyOnchainRes.statusCode, 200);
    const verifyOnchainBody = verifyOnchainRes.body as { valid: boolean };
    assert.strictEqual(verifyOnchainBody.valid, true);

    // 7. Finalize
    const finalizeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/finalize`,
    });
    assert.strictEqual(finalizeRes.statusCode, 200);

    const onchainFinal = await soroban.getOnChainCase(terms.caseId);
    if (!onchainFinal) throw new Error("Expected onchainFinal to exist");
    assert.strictEqual(onchainFinal.status, "FINALIZED");

    const dbCase = await caseRepo.findById(terms.caseId, "testnet");
    if (!dbCase) throw new Error("Expected dbCase to exist");
    assert.strictEqual(dbCase.status, "FINALIZED");
    assert.ok(dbCase.dispute_tx_hash);
    assert.ok(dbCase.resolution_tx_hash);
    assert.ok(dbCase.finalization_tx_hash);
  });
});
