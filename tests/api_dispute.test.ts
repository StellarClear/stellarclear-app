import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import { createApiServer, SorobanSettlementAnchor } from "@stellarclear/api";
import type { ExpectedSettlement, ObservedSettlement } from "@stellarclear/schemas";
import type { TransactionResult } from "@stellarclear/sdk";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";

class MockAnchorService extends SorobanSettlementAnchor {
  public disputeCalls: Array<{ initiator: string; caseId: string; disputeCommitment: string }> = [];
  public resolutionCalls: Array<{ resolver: string; caseId: string; resolutionCommitment: string }> = [];

  public override async anchorDispute(params: {
    initiator: string;
    caseId: string;
    disputeCommitment: string;
  }): Promise<TransactionResult<void>> {
    this.disputeCalls.push(params);
    return {
      txHash: `0x_dispute_tx_${params.caseId.slice(0, 8)}`,
      status: "SUCCESS",
      ledger: 1234580,
      result: undefined,
    };
  }

  public override async anchorResolution(params: {
    resolver: string;
    caseId: string;
    resolutionCommitment: string;
  }): Promise<TransactionResult<void>> {
    this.resolutionCalls.push(params);
    return {
      txHash: `0x_resolve_tx_${params.caseId.slice(0, 8)}`,
      status: "SUCCESS",
      ledger: 1234590,
      result: undefined,
    };
  }
}

describe("API Service - Settlement Dispute Workflow", () => {
  const sampleTerms: ExpectedSettlement = {
    caseId: "3333333333333333333333333333333333333333333333333333333333333333",
    owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    tradeReference: "TRADE-DISPUTE-001",
    asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    amount: "100000.00",
    expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    deadline: 1234567,
  };

  const brokenObserved: ObservedSettlement = {
    txHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ledger: 1234560,
    asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    amount: "90000.00", // Break: underpaid
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

  it("executes full dispute and resolution lifecycle: BREAK → DISPUTED → RESOLVED", async () => {
    const { server, anchor } = setup();

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    // 2. Observe Break
    await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/observe`,
      body: { observation: brokenObserved },
    });

    // 3. Reconcile to BREAK status
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; matched: boolean };
    assert.strictEqual(recBody.status, "BREAK");
    assert.strictEqual(recBody.matched, false);

    // 4. Open Dispute (POST /v1/cases/:caseId/dispute)
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
      body: {
        initiator: sampleTerms.owner,
        reason: "Amount mismatch: expected 100,000 USDC but received 90,000 USDC",
        evidence: {
          expectedAmount: "100000.00",
          observedAmount: "90000.00",
          shortfall: "10000.00",
        },
      },
    });

    assert.strictEqual(disputeRes.statusCode, 201);
    const disputeBody = disputeRes.body as {
      caseId: string;
      status: string;
      disputeCommitment: string;
      txHash: string;
    };
    assert.strictEqual(disputeBody.status, "DISPUTED");
    assert.strictEqual(disputeBody.txHash, `0x_dispute_tx_${sampleTerms.caseId.slice(0, 8)}`);
    assert.strictEqual(anchor.disputeCalls.length, 1);

    // 5. Query Dispute (GET /v1/cases/:caseId/dispute)
    const getDisputeRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
    });
    assert.strictEqual(getDisputeRes.statusCode, 200);
    const getDisputeBody = getDisputeRes.body as {
      caseId: string;
      status: string;
      dispute?: { initiator: string; reason: string };
    };
    assert.strictEqual(getDisputeBody.status, "DISPUTED");
    assert.strictEqual(getDisputeBody.dispute?.initiator, sampleTerms.owner);

    // 6. First Resolution Submission (Owner only) — MUST remain DISPUTED
    const resolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/resolve`,
      body: {
        resolver: sampleTerms.owner,
        resolutionType: "SUPPLEMENTARY_SETTLEMENT_AGREED",
        agreedAmount: "100000.00",
        details: {
          settlementMethod: "PARTIAL_CREDIT_MEMO",
          creditMemoId: "CM-9988",
        },
      },
    });

    assert.strictEqual(resolveRes.statusCode, 200);
    const resolveBody = resolveRes.body as {
      caseId: string;
      status: string;
      resolutionCommitment: string;
      txHash: string;
      mutualResolutionAchieved?: boolean;
    };
    // First submission must NOT mark case RESOLVED — must remain DISPUTED
    assert.strictEqual(resolveBody.status, "DISPUTED");
    assert.strictEqual(resolveBody.mutualResolutionAchieved, false);
    assert.strictEqual(anchor.resolutionCalls.length, 1);

    // Verify DB case status remains DISPUTED after single submission
    const interimCaseRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${sampleTerms.caseId}`,
    });
    assert.strictEqual((interimCaseRes.body as { status: string }).status, "DISPUTED");

    // 6b. Second Resolution Submission (Counterparty with matching commitment) — becomes RESOLVED
    const cpResolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/resolve`,
      body: {
        resolver: sampleTerms.counterparty,
        resolutionType: "SUPPLEMENTARY_SETTLEMENT_AGREED",
        resolutionCommitment: resolveBody.resolutionCommitment,
      },
    });

    assert.strictEqual(cpResolveRes.statusCode, 200);
    const cpResolveBody = cpResolveRes.body as {
      caseId: string;
      status: string;
      resolutionCommitment: string;
      mutualResolutionAchieved?: boolean;
    };
    assert.strictEqual(cpResolveBody.status, "RESOLVED");
    assert.strictEqual(cpResolveBody.mutualResolutionAchieved, true);
    assert.strictEqual(anchor.resolutionCalls.length, 2);

    // 7. Verify case status is now RESOLVED
    const caseRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${sampleTerms.caseId}`,
    });
    assert.strictEqual(caseRes.statusCode, 200);
    const caseBody = caseRes.body as { status: string };
    assert.strictEqual(caseBody.status, "RESOLVED");
  });

  it("rejects dispute opening when case status is OPEN (400 INVALID_STATE)", async () => {
    const { server } = setup();

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
      body: {
        initiator: sampleTerms.owner,
        reason: "Premature dispute on OPEN case",
      },
    });

    assert.strictEqual(res.statusCode, 400);
    const body = res.body as { error: { code: string; message: string } };
    assert.strictEqual(body.error.code, "INVALID_STATE");
  });

  it("rejects dispute opening when case status is OBSERVED (400 INVALID_STATE)", async () => {
    const { server } = setup();

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/observe`,
      body: { observation: brokenObserved },
    });

    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
      body: {
        initiator: sampleTerms.owner,
        reason: "Premature dispute on OBSERVED case before reconciliation",
      },
    });

    assert.strictEqual(res.statusCode, 400);
    const obsBody = res.body as { error: { code: string; message: string } };
    assert.strictEqual(obsBody.error.code, "INVALID_STATE");
  });

  it("keeps case in DISPUTED state when second resolution has non-matching commitment", async () => {
    const { server } = setup();

    await server.inject({ method: "POST", url: "/v1/cases", body: { expected: sampleTerms } });
    await server.inject({ method: "POST", url: `/v1/cases/${sampleTerms.caseId}/observe`, body: { observation: brokenObserved } });
    await server.inject({ method: "POST", url: `/v1/cases/${sampleTerms.caseId}/reconcile` });
    await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
      body: { initiator: sampleTerms.owner, reason: "Break detected" },
    });

    // Owner resolves with commitment A
    await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/resolve`,
      body: {
        resolver: sampleTerms.owner,
        resolutionType: "PROPOSAL_A",
        resolutionCommitment: "1111111111111111111111111111111111111111111111111111111111111111",
      },
    });

    // Counterparty resolves with DIFFERENT commitment B
    const cpRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/resolve`,
      body: {
        resolver: sampleTerms.counterparty,
        resolutionType: "PROPOSAL_B",
        resolutionCommitment: "2222222222222222222222222222222222222222222222222222222222222222",
      },
    });

    assert.strictEqual(cpRes.statusCode, 200);
    const cpBody = cpRes.body as { status: string; mutualResolutionAchieved: boolean };
    assert.strictEqual(cpBody.status, "DISPUTED");
    assert.strictEqual(cpBody.mutualResolutionAchieved, false);

    // Case in DB must still be DISPUTED
    const caseRes = await server.inject({ method: "GET", url: `/v1/cases/${sampleTerms.caseId}` });
    assert.strictEqual((caseRes.body as { status: string }).status, "DISPUTED");
  });

  it("preserves dispute and resolution evidence across server restart without in-memory maps", async () => {
    const db = new InMemoryDatabaseClient();
    const anchor = new MockAnchorService();

    // Instance 1
    const server1 = createApiServer(
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

    await server1.inject({ method: "POST", url: "/v1/cases", body: { expected: sampleTerms } });
    await server1.inject({ method: "POST", url: `/v1/cases/${sampleTerms.caseId}/observe`, body: { observation: brokenObserved } });
    await server1.inject({ method: "POST", url: `/v1/cases/${sampleTerms.caseId}/reconcile` });
    await server1.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
      body: { initiator: sampleTerms.owner, reason: "Durable dispute evidence test" },
    });
    await server1.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/resolve`,
      body: {
        resolver: sampleTerms.owner,
        resolutionType: "PARTIAL_SETTLEMENT",
        resolutionCommitment: "4444444444444444444444444444444444444444444444444444444444444444",
      },
    });

    // Simulate process restart by creating new server instance with the same dbClient
    const server2 = createApiServer(
      {
        port: 3001,
        host: "0.0.0.0",
        network: TEST_NETWORK,
        databaseUrl: "postgres://localhost:5432/test",
        contractId: TEST_CONTRACT_ID,
      },
      db,
      anchor
    );

    const disputeRes = await server2.inject({
      method: "GET",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
    });

    assert.strictEqual(disputeRes.statusCode, 200);
    const disputeBody = disputeRes.body as {
      caseId: string;
      status: string;
      dispute?: { initiator: string; reason: string };
      resolutions: Array<{ resolver: string; resolutionCommitment: string }>;
    };
    assert.strictEqual(disputeBody.status, "DISPUTED");
    assert.strictEqual(disputeBody.dispute?.initiator, sampleTerms.owner);
    assert.strictEqual(disputeBody.dispute?.reason, "Durable dispute evidence test");
    assert.strictEqual(disputeBody.resolutions.length, 1);
    assert.strictEqual(disputeBody.resolutions[0].resolver, sampleTerms.owner);
  });

  it("rejects resolution when case is not in DISPUTED state (400)", async () => {
    const { server } = setup();

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/resolve`,
      body: {
        resolver: sampleTerms.owner,
        resolutionType: "MUTUAL_AGREEMENT",
      },
    });

    assert.strictEqual(res.statusCode, 400);
  });

  it("returns 404 for non-existent dispute case", async () => {
    const { server } = setup();

    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/dispute`,
      body: {
        initiator: sampleTerms.owner,
        reason: "Test",
      },
    });

    assert.strictEqual(res.statusCode, 404);
  });
});
