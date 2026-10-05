import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import { createApiServer, SorobanSettlementAnchor } from "@stellarclear/api";
import { computeTermsCommitment } from "@stellarclear/proof";
import type { ExpectedSettlement, ObservedSettlement, SettlementProof } from "@stellarclear/schemas";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";

describe("Integration - End-to-End Settlement Lifecycles", () => {
  function setupServer() {
    const db = new InMemoryDatabaseClient();
    const anchor = new SorobanSettlementAnchor();
    const server = createApiServer(
      {
        port: 3000,
        host: "0.0.0.0",
        network: TEST_NETWORK,
        databaseUrl: "postgres://localhost:5432/test",
        contractId: TEST_CONTRACT_ID,
      },
      db,
      anchor
    );
    return { db, server };
  }

  it("completes full happy-path match lifecycle from creation to on-chain finalization", async () => {
    const { server } = setupServer();

    const terms: ExpectedSettlement = {
      caseId: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TRADE-E2E-MATCH-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "250000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-E2E-001",
      deadline: 1250000,
    };

    const observed: ObservedSettlement = {
      txHash: "d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1",
      ledger: 1249950,
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "250000.00",
      destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-E2E-001",
      status: "SUCCESS",
      observedAt: "2026-09-29T14:00:00.000Z",
    };

    // Step 1: Create Case
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });
    assert.strictEqual(createRes.statusCode, 201);
    const createBody = createRes.body as { status: string; termsCommitment: string; txHash?: string };
    assert.strictEqual(createBody.status, "OPEN");
    assert.ok(createBody.txHash);

    // Step 2: Observe Settlement Transaction
    const obsRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/observe`,
      body: { observation: observed },
    });
    assert.strictEqual(obsRes.statusCode, 200);
    const obsBody = obsRes.body as { status: string; txHash?: string };
    assert.strictEqual(obsBody.status, "OBSERVED");

    // Step 3: Reconcile Settlement
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; matched: boolean; breaks: unknown[] };
    assert.strictEqual(recBody.status, "MATCHED");
    assert.strictEqual(recBody.matched, true);
    assert.strictEqual(recBody.breaks.length, 0);

    // Step 4: Submit Attestation from Owner
    const termsCommitment = computeTermsCommitment(terms);
    const attestRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/attest`,
      body: {
        role: "OWNER",
        attestor: terms.owner,
        commitment: termsCommitment,
      },
    });
    assert.strictEqual(attestRes.statusCode, 201);

    // Step 5: Generate Settlement Proof
    const proofRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${terms.caseId}/proof`,
    });
    assert.strictEqual(proofRes.statusCode, 200);
    const proof = proofRes.body as SettlementProof;
    assert.strictEqual(proof.caseId, terms.caseId);
    assert.strictEqual(proof.result, "MATCHED");
    assert.strictEqual(proof.attestations.length, 1);

    // Step 6: Verify Settlement Proof (Offline Cryptographic Verification)
    const verifyRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify",
      body: {
        proof,
        termsDocument: terms,
        observedDocument: observed,
      },
    });
    assert.strictEqual(verifyRes.statusCode, 200);
    const verifyBody = verifyRes.body as { valid: boolean };
    assert.strictEqual(verifyBody.valid, true);

    // Step 7: Finalize Settlement on Soroban
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/finalize`,
    });
    assert.strictEqual(finRes.statusCode, 200);
    const finBody = finRes.body as { status: string; finalizationTxHash?: string };
    assert.strictEqual(finBody.status, "FINALIZED");
    assert.ok(finBody.finalizationTxHash);

    // Step 8: Verify Final Case Status
    const finalCaseRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${terms.caseId}`,
    });
    assert.strictEqual(finalCaseRes.statusCode, 200);
    const finalCaseBody = finalCaseRes.body as { status: string };
    assert.strictEqual(finalCaseBody.status, "FINALIZED");
  });

  it("completes full break, dispute, resolution, and finalization lifecycle", async () => {
    const { server } = setupServer();

    const terms: ExpectedSettlement = {
      caseId: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TRADE-E2E-DISPUTE-002",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "500000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      deadline: 1260000,
    };

    const brokenObserved: ObservedSettlement = {
      txHash: "e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2",
      ledger: 1259900,
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "450000.00", // 50,000 shortfall
      destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      status: "SUCCESS",
      observedAt: "2026-09-29T14:30:00.000Z",
    };

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // 2. Observe Break
    await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/observe`,
      body: { observation: brokenObserved },
    });

    // 3. Reconcile to BREAK
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/reconcile`,
    });
    const recBody = recRes.body as { status: string; breaks: Array<{ code: string }> };
    assert.strictEqual(recBody.status, "BREAK");
    assert.strictEqual(recBody.breaks[0].code, "AMOUNT_MISMATCH");

    // 4. Open Dispute
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/dispute`,
      body: {
        initiator: terms.owner,
        reason: "Underpayment of 50,000 USDC detected during automated matching",
        evidence: {
          expectedAmount: "500000.00",
          observedAmount: "450000.00",
        },
      },
    });
    assert.strictEqual(disputeRes.statusCode, 201);
    const disputeBody = disputeRes.body as { status: string };
    assert.strictEqual(disputeBody.status, "DISPUTED");

    // 5. Submit Resolution (Counterparty submits, then Owner submits matching resolution)
    const resolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver: terms.counterparty,
        resolutionType: "MUTUAL_SETTLEMENT_RECONCILIATION",
        agreedAmount: "500000.00",
        details: {
          supplementalTxHash: "f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3",
        },
      },
    });
    assert.strictEqual(resolveRes.statusCode, 200);
    const interimResolveBody = resolveRes.body as { status: string; resolutionCommitment: string };
    assert.strictEqual(interimResolveBody.status, "DISPUTED");

    const ownerResolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver: terms.owner,
        resolutionType: "MUTUAL_SETTLEMENT_RECONCILIATION",
        resolutionCommitment: interimResolveBody.resolutionCommitment,
      },
    });
    assert.strictEqual(ownerResolveRes.statusCode, 200);
    const resolveBody = ownerResolveRes.body as { status: string };
    assert.strictEqual(resolveBody.status, "RESOLVED");

    // 6. Finalize Case
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/finalize`,
    });
    assert.strictEqual(finRes.statusCode, 200);
    const finBody = finRes.body as { status: string };
    assert.strictEqual(finBody.status, "FINALIZED");

    // 7. Verify Final Case Record
    const finalCaseRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${terms.caseId}`,
    });
    assert.strictEqual(finalCaseRes.statusCode, 200);
    const finalCaseBody = finalCaseRes.body as { status: string; finalizationTxHash?: string };
    assert.strictEqual(finalCaseBody.status, "FINALIZED");
    assert.ok(finalCaseBody.finalizationTxHash);
  });
});
