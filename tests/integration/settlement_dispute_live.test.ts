import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupLiveSettlementEnvironment } from "./helpers/soroban.js";
import type {
  ExpectedSettlement,
  ObservedSettlement,
  SettlementProof,
} from "@stellarclear/schemas";

describe("Live Integration - Settlement Dispute and Resolution Workflow", () => {
  it("manages disputed settlement cases through arbitration resolution on Soroban", async () => {
    const { soroban, server } = setupLiveSettlementEnvironment();

    const terms: ExpectedSettlement = {
      caseId: "3333444455556666777788889999000033334444555566667777888899990000",
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "DISPUTE-LIVE-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "450000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-DISPUTE-01",
      deadline: 1950000,
    };

    const observed: ObservedSettlement = {
      txHash: "1234567812345678123456781234567812345678123456781234567812345678",
      ledger: 1900000,
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "400000.00",
      destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-DISPUTE-01",
      status: "SUCCESS",
      observedAt: "2026-09-29T15:30:00.000Z",
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

    // 3. Reconcile (breaks due to amount)
    await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/reconcile`,
    });

    // 4. Open Dispute
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/dispute`,
      body: {
        initiator: terms.owner,
        reason: "Amount mismatch detected in settlement",
      },
    });
    assert.strictEqual(disputeRes.statusCode, 201);

    const onchainDispute = await soroban.getOnChainCase(terms.caseId);
    if (!onchainDispute) throw new Error("Expected onchainDispute to exist");
    assert.strictEqual(onchainDispute.status, "DISPUTED");

    // 5. Submit Resolution from counterparty and owner
    const resolver = terms.counterparty ?? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const resolutionCommitment = "eeee5555ffff6666aaaa7777bbbb8888eeee5555ffff6666aaaa7777bbbb8888";
    const resolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver,
        resolutionType: "AGREE_MODIFIED_AMOUNT",
        agreedAmount: "400000.00",
        resolutionCommitment,
      },
    });
    assert.strictEqual(resolveRes.statusCode, 200);

    const ownerResolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver: terms.owner,
        resolutionType: "AGREE_MODIFIED_AMOUNT",
        agreedAmount: "400000.00",
        resolutionCommitment,
      },
    });
    assert.strictEqual(ownerResolveRes.statusCode, 200);

    const onchainResolve = await soroban.getOnChainCase(terms.caseId);
    if (!onchainResolve) throw new Error("Expected onchainResolve to exist");
    assert.strictEqual(onchainResolve.status, "RESOLVED");

    const onchainResolutionHash = await soroban.getOnChainResolution(terms.caseId, resolver);
    assert.strictEqual(onchainResolutionHash, resolutionCommitment);

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

    // 7. Finalize Case
    const finalizeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/finalize`,
    });
    assert.strictEqual(finalizeRes.statusCode, 200);

    const finalCase = await soroban.getOnChainCase(terms.caseId);
    if (!finalCase) throw new Error("Expected finalCase to exist");
    assert.strictEqual(finalCase.status, "FINALIZED");
  });
});
