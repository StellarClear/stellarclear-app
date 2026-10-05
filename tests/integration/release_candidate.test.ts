import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupLiveSettlementEnvironment, TEST_LIVE_CONTRACT_ID, TEST_LIVE_NETWORK } from "./helpers/soroban.js";
import { computeTermsCommitment, computeObservationCommitment, verifySettlementProof } from "@stellarclear/proof";
import type {
  ExpectedSettlement,
  ObservedSettlement,
  SettlementProof,
} from "@stellarclear/schemas";
import type { CaseConsistencyResponse } from "@stellarclear/api";

const VALID_OWNER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYORMA3Y4H3EL2PUGQY";
const VALID_CP = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const VALID_ASSET = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("Integration - Release-Candidate Full Stack Regression", () => {
  it("executes RC Clean Path: Create -> Observe -> Reconcile Match -> Attest -> Proof -> Finalize -> Cross-Layer Sync", async () => {
    const { server } = setupLiveSettlementEnvironment();

    const caseId = "e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1";
    const terms: ExpectedSettlement = {
      caseId,
      owner: VALID_OWNER,
      counterparty: VALID_CP,
      tradeReference: "TRADE-RC-001",
      asset: VALID_ASSET,
      amount: "250000.0000000",
      expectedDestination: VALID_OWNER,
      reference: "INV-RC-001",
      deadline: 1800000,
    };

    // 1. Create Case
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });
    assert.strictEqual(createRes.statusCode, 201);
    const createBody = createRes.body as { caseId: string; status: string; txHash?: string };
    assert.strictEqual(createBody.caseId, caseId);
    assert.strictEqual(createBody.status, "OPEN");

    // 2. Observe Settlement
    const observation: ObservedSettlement = {
      txHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ledger: 1600000,
      asset: terms.asset,
      amount: terms.amount,
      destination: terms.expectedDestination,
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };

    const obsRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation },
    });
    assert.strictEqual(obsRes.statusCode, 200);

    // 3. Reconcile -> MATCHED
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; matched: boolean };
    assert.strictEqual(recBody.matched, true);
    assert.strictEqual(recBody.status, "MATCHED");

    // 4. Submit Attestations from Owner & Counterparty
    const termsCommitment = computeTermsCommitment(terms);
    const attestRes1 = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: terms.owner,
        role: "OWNER",
        commitment: termsCommitment,
      },
    });
    assert.strictEqual(attestRes1.statusCode, 201);

    const attestRes2 = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: terms.counterparty!,
        role: "COUNTERPARTY",
        commitment: termsCommitment,
      },
    });
    assert.strictEqual(attestRes2.statusCode, 201);

    // 5. Generate Proof via API
    const proofRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/proof`,
    });
    assert.strictEqual(proofRes.statusCode, 200);
    const proof = proofRes.body as SettlementProof;
    assert.strictEqual(proof.caseId, caseId);
    assert.strictEqual(proof.result, "MATCHED");
    assert.strictEqual(proof.attestations.length, 2);

    // 6. Verify Proof on-chain
    const verifyRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify/onchain",
      body: {
        proof,
        termsDocument: terms,
        observedDocument: observation,
      },
    });
    assert.strictEqual(verifyRes.statusCode, 200);
    const verifyBody = verifyRes.body as { valid: boolean; checks?: unknown };
    assert.strictEqual(verifyBody.valid, true);

    // 7. Finalize Case
    const finalizeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/finalize`,
    });
    assert.strictEqual(finalizeRes.statusCode, 200);

    // 8. Cross-layer consistency check
    const consistencyRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/consistency`,
    });
    assert.strictEqual(consistencyRes.statusCode, 200);
    const consistency = consistencyRes.body as CaseConsistencyResponse;
    assert.strictEqual(consistency.isConsistent, true);
    assert.strictEqual(consistency.consistencyStatus, "CONSISTENT");
  });

  it("executes RC Dispute Path: Create -> Break -> Dispute -> Resolution -> Proof -> Finalize", async () => {
    const { server } = setupLiveSettlementEnvironment();

    const caseId = "e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2";
    const terms: ExpectedSettlement = {
      caseId,
      owner: VALID_OWNER,
      counterparty: VALID_CP,
      tradeReference: "TRADE-RC-BREAK-002",
      asset: VALID_ASSET,
      amount: "50000.0000000",
      expectedDestination: VALID_OWNER,
      reference: "INV-RC-002",
      deadline: 1800000,
    };

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // 2. Observe Break (Wrong Amount)
    const brokenObservation: ObservedSettlement = {
      txHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ledger: 1610000,
      asset: terms.asset,
      amount: "40000.0000000", // Mismatched amount
      destination: terms.expectedDestination,
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };

    await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation: brokenObservation },
    });

    // 3. Reconcile -> BREAK
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; matched: boolean; breaks?: Array<{ code: string }> };
    assert.strictEqual(recBody.matched, false);
    assert.strictEqual(recBody.status, "BREAK");
    assert.ok(recBody.breaks?.some((b) => b.code === "AMOUNT_MISMATCH"));

    // 4. Open Dispute
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/dispute`,
      body: {
        reason: "Partial wire transfer under-delivered",
        initiator: terms.owner,
      },
    });
    assert.strictEqual(disputeRes.statusCode, 201);
    const disputeBody = disputeRes.body as { status: string };
    assert.strictEqual(disputeBody.status, "DISPUTED");

    // 5. Submit Resolution (Both counterparty and owner submit matching resolution)
    const resolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/resolve`,
      body: {
        resolver: terms.counterparty!,
        resolutionType: "MUTUAL_AGREEMENT",
        details: { summary: "Parties agreed on discounted fee terms of 40,000 USDC" },
        agreedAmount: "40000.0000000",
      },
    });
    assert.strictEqual(resolveRes.statusCode, 200);
    const interimResolveBody = resolveRes.body as { status: string; resolutionCommitment: string };
    assert.strictEqual(interimResolveBody.status, "DISPUTED");

    const ownerRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/resolve`,
      body: {
        resolver: terms.owner,
        resolutionType: "MUTUAL_AGREEMENT",
        resolutionCommitment: interimResolveBody.resolutionCommitment,
      },
    });
    assert.strictEqual(ownerRes.statusCode, 200);
    const resolveBody = ownerRes.body as { status: string };
    assert.strictEqual(resolveBody.status, "RESOLVED");

    // 6. Finalize Dispute
    const finalizeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/finalize`,
    });
    assert.strictEqual(finalizeRes.statusCode, 200);

    // 7. Verify History reflects dispute & resolution
    const historyRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/history`,
    });
    assert.strictEqual(historyRes.statusCode, 200);
    const historyBody = historyRes.body as { history: Array<{ event: string }> };
    assert.ok(historyBody.history.some((h) => h.event === "DISPUTED"));
    assert.ok(historyBody.history.some((h) => h.event === "RESOLVED"));
    assert.ok(historyBody.history.some((h) => h.event === "FINALIZED"));
  });
});

