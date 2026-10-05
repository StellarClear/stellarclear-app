import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import { createApiServer, SorobanSettlementAnchor } from "@stellarclear/api";
import type { ExpectedSettlement, ObservedSettlement } from "@stellarclear/schemas";
import type { TransactionResult } from "@stellarclear/sdk";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";

class MockAnchorService extends SorobanSettlementAnchor {
  public finalizationCalls: Array<{ caseId: string }> = [];

  public override async anchorFinalization(params: {
    caseId: string;
  }): Promise<TransactionResult<void>> {
    this.finalizationCalls.push(params);
    return {
      txHash: `0x_finalize_tx_${params.caseId.slice(0, 8)}`,
      status: "SUCCESS",
      ledger: 1234599,
      result: undefined,
    };
  }
}

describe("API Service - Settlement Finalization on Soroban", () => {
  const sampleTerms: ExpectedSettlement = {
    caseId: "4444444444444444444444444444444444444444444444444444444444444444",
    owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    tradeReference: "TRADE-FINALIZE-001",
    asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    amount: "75000.00",
    expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    deadline: 1234567,
  };

  const matchingObserved: ObservedSettlement = {
    txHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ledger: 1234560,
    asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    amount: "75000.00",
    destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    status: "SUCCESS",
    observedAt: "2026-09-29T12:00:00.000Z",
  };

  function setup() {
    const db = new InMemoryDatabaseClient();
    const anchor = new MockAnchorService();
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
    return { db, anchor, server };
  }

  it("finalizes a MATCHED case: MATCHED → FINALIZED", async () => {
    const { server, anchor } = setup();

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    // 2. Observe Match
    await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/observe`,
      body: { observation: matchingObserved },
    });

    // 3. Reconcile to MATCHED
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);

    // 4. Finalize Case (POST /v1/cases/:caseId/finalize)
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/finalize`,
    });

    assert.strictEqual(finRes.statusCode, 200);
    const body = finRes.body as {
      caseId: string;
      status: string;
      finalizationTxHash: string;
      finalizedAtLedger: number;
    };
    assert.strictEqual(body.caseId, sampleTerms.caseId);
    assert.strictEqual(body.status, "FINALIZED");
    assert.strictEqual(body.finalizationTxHash, `0x_finalize_tx_${sampleTerms.caseId.slice(0, 8)}`);
    assert.strictEqual(body.finalizedAtLedger, 1234599);
    assert.strictEqual(anchor.finalizationCalls.length, 1);

    // 5. Verify case state is FINALIZED
    const getCaseRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${sampleTerms.caseId}`,
    });
    assert.strictEqual(getCaseRes.statusCode, 200);
    const caseData = getCaseRes.body as { status: string; finalizationTxHash?: string };
    assert.strictEqual(caseData.status, "FINALIZED");
  });

  it("finalizes a RESOLVED case: RESOLVED → FINALIZED", async () => {
    const { server, anchor } = setup();

    const brokenCaseTerms = {
      ...sampleTerms,
      caseId: "5555555555555555555555555555555555555555555555555555555555555555",
      tradeReference: "TRADE-RESOLVE-FINALIZE-001",
    };

    const breakObserved = {
      ...matchingObserved,
      amount: "50000.00",
    };

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: brokenCaseTerms },
    });

    // 2. Observe Break
    await server.inject({
      method: "POST",
      url: `/v1/cases/${brokenCaseTerms.caseId}/observe`,
      body: { observation: breakObserved },
    });

    // 3. Reconcile to BREAK
    await server.inject({
      method: "POST",
      url: `/v1/cases/${brokenCaseTerms.caseId}/reconcile`,
    });

    // 4. Open Dispute
    await server.inject({
      method: "POST",
      url: `/v1/cases/${brokenCaseTerms.caseId}/dispute`,
      body: {
        initiator: brokenCaseTerms.owner,
        reason: "Amount underpaid",
      },
    });

    // 5. Resolve Dispute (both owner and counterparty submit matching resolution)
    const resolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${brokenCaseTerms.caseId}/resolve`,
      body: {
        resolver: brokenCaseTerms.owner,
        resolutionType: "MUTUAL_SETTLEMENT_AMENDMENT",
      },
    });
    const resolveBody = resolveRes.body as { resolutionCommitment: string };

    await server.inject({
      method: "POST",
      url: `/v1/cases/${brokenCaseTerms.caseId}/resolve`,
      body: {
        resolver: brokenCaseTerms.counterparty,
        resolutionType: "MUTUAL_SETTLEMENT_AMENDMENT",
        resolutionCommitment: resolveBody.resolutionCommitment,
      },
    });

    // 6. Finalize Case
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${brokenCaseTerms.caseId}/finalize`,
    });

    assert.strictEqual(finRes.statusCode, 200);
    const body = finRes.body as { status: string };
    assert.strictEqual(body.status, "FINALIZED");
  });

  it("rejects finalization when case is in OPEN or BREAK state (400)", async () => {
    const { server } = setup();

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/finalize`,
    });

    assert.strictEqual(res.statusCode, 400);
  });

  it("returns 404 for non-existent case finalization", async () => {
    const { server } = setup();

    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/finalize`,
    });

    assert.strictEqual(res.statusCode, 404);
  });
});
