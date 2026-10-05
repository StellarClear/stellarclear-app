import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import { createApiServer, SorobanSettlementAnchor } from "@stellarclear/api";
import type { ExpectedSettlement, ObservedSettlement } from "@stellarclear/schemas";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";

describe("Integration - Dispute Resolution & Verification", () => {
  function setup() {
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

  it("handles opening a dispute with evidence, resolving it with agreed terms, and finalizing", async () => {
    const { server } = setup();

    const terms: ExpectedSettlement = {
      caseId: "8888888888888888888888888888888888888888888888888888888888888888",
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "CORP-PAYROLL-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "800000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      deadline: 1500000,
    };

    const observed: ObservedSettlement = {
      txHash: "9999999999999999999999999999999999999999999999999999999999999999",
      ledger: 1490000,
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "700000.00", // 100,000 break
      destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      status: "SUCCESS",
      observedAt: "2026-09-29T11:00:00.000Z",
    };

    // 1. Create case & observe
    await server.inject({ method: "POST", url: "/v1/cases", body: { expected: terms } });
    await server.inject({ method: "POST", url: `/v1/cases/${terms.caseId}/observe`, body: { observation: observed } });

    // 2. Reconcile
    const recRes = await server.inject({ method: "POST", url: `/v1/cases/${terms.caseId}/reconcile` });
    assert.strictEqual(recRes.statusCode, 200);

    // 3. Open Dispute
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/dispute`,
      body: {
        initiator: terms.owner,
        reason: "Payroll shortfall 100k USDC",
        evidence: {
          payrollBatchId: "BATCH-2026-09",
          expectedHeadcount: "150",
        },
      },
    });
    assert.strictEqual(disputeRes.statusCode, 201);
    const disputeBody = disputeRes.body as { status: string; disputeCommitment: string; txHash: string };
    assert.strictEqual(disputeBody.status, "DISPUTED");
    assert.ok(disputeBody.disputeCommitment);

    // 4. Resolve Dispute: Counterparty submits, then Owner submits matching resolution
    const cpResolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver: terms.counterparty,
        resolutionType: "SUPPLEMENTAL_PAYMENT_AUTHORIZED",
        agreedAmount: "800000.00",
        details: {
          wireReference: "WIRE-9911-COMPLETE",
        },
      },
    });
    assert.strictEqual(cpResolveRes.statusCode, 200);
    const cpResolveBody = cpResolveRes.body as { status: string; resolutionCommitment: string };
    assert.strictEqual(cpResolveBody.status, "DISPUTED");

    const ownerResolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/resolve`,
      body: {
        resolver: terms.owner,
        resolutionType: "SUPPLEMENTAL_PAYMENT_AUTHORIZED",
        resolutionCommitment: cpResolveBody.resolutionCommitment,
      },
    });
    assert.strictEqual(ownerResolveRes.statusCode, 200);
    const resolveBody = ownerResolveRes.body as { status: string; resolutionCommitment: string };
    assert.strictEqual(resolveBody.status, "RESOLVED");
    assert.ok(resolveBody.resolutionCommitment);

    // 5. Finalize
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${terms.caseId}/finalize`,
    });
    assert.strictEqual(finRes.statusCode, 200);
    assert.strictEqual((finRes.body as { status: string }).status, "FINALIZED");
  });
});
