import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import {
  createApiServer,
  SorobanSettlementAnchor,
  type SettlementDiagnosticsResponse,
} from "@stellarclear/api";
import type { ExpectedSettlement, ObservedSettlement } from "@stellarclear/schemas";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";
const VALID_OWNER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYORMA3Y4H3EL2PUGQY";
const VALID_DESTINATION = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const VALID_ASSET = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("API Service - Structured Settlement Health Diagnostics", () => {
  it("returns comprehensive 200 diagnostics on GET /v1/operations/diagnostics", async () => {
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

    const res = await server.inject({
      method: "GET",
      url: "/v1/operations/diagnostics",
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as SettlementDiagnosticsResponse;

    assert.strictEqual(body.status, "healthy");
    assert.strictEqual(body.version, "0.1.0");
    assert.ok(typeof body.uptimeSeconds === "number");
    assert.ok(body.timestamp);

    // Database diagnostics
    assert.strictEqual(body.database.status, "healthy");
    assert.strictEqual(body.database.totalCases, 0);
    assert.ok(typeof body.database.latencyMs === "number");

    // Contract diagnostics
    assert.strictEqual(body.contract.status, "healthy");
    assert.strictEqual(body.contract.contractId, TEST_CONTRACT_ID);
    assert.strictEqual(body.contract.network, TEST_NETWORK);
    assert.ok(typeof body.contract.rpcLatencyMs === "number");

    // Indexing diagnostics
    assert.strictEqual(body.indexing.status, "synced");

    // Pipeline metrics
    assert.strictEqual(body.pipeline.openCases, 0);
    assert.strictEqual(body.pipeline.matchedCases, 0);
    assert.strictEqual(body.pipeline.brokenCases, 0);
  });

  it("updates pipeline metrics accurately as settlement cases are processed", async () => {
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

    const caseId = "1111111111111111111111111111111111111111111111111111111111111111";
    const terms: ExpectedSettlement = {
      caseId,
      owner: VALID_OWNER,
      counterparty: VALID_DESTINATION,
      tradeReference: "TR-DIAG-001",
      asset: VALID_ASSET,
      amount: "1000.0000000",
      expectedDestination: VALID_DESTINATION,
      reference: "INV-DIAG-001",
      deadline: 600000,
    };

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // Check diagnostics reflect 1 open case
    const diag1 = await server.inject({ method: "GET", url: "/v1/diagnostics" });
    assert.strictEqual(diag1.statusCode, 200);
    const body1 = diag1.body as SettlementDiagnosticsResponse;
    assert.strictEqual(body1.database.totalCases, 1);
    assert.strictEqual(body1.pipeline.openCases, 1);

    // 2. Observe & Reconcile -> MATCHED
    const observation: ObservedSettlement = {
      txHash: "2222222222222222222222222222222222222222222222222222222222222222",
      ledger: 500000,
      asset: terms.asset,
      amount: terms.amount,
      destination: terms.expectedDestination,
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };

    await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation },
    });

    await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });

    // Check diagnostics reflect 1 matched case
    const diag2 = await server.inject({ method: "GET", url: "/v1/operations/diagnostics" });
    assert.strictEqual(diag2.statusCode, 200);
    const body2 = diag2.body as SettlementDiagnosticsResponse;
    assert.strictEqual(body2.database.totalCases, 1);
    assert.strictEqual(body2.pipeline.openCases, 0);
    assert.strictEqual(body2.pipeline.matchedCases, 1);

    // Release metadata in diagnostics
    assert.strictEqual(body2.release.protocol, "STELLARCLEAR");
    assert.strictEqual(body2.release.version, "0.1.0");
    assert.strictEqual(body2.release.contract.name, "settlement_registry");
    assert.strictEqual(body2.release.contract.version, "0.1.1");
    assert.strictEqual(body2.release.contract.compatible, true);
    assert.ok(body2.release.features.includes("case_creation"));
  });

  it("returns protocol and pinned contract release details on GET /v1/version", async () => {
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

    const res = await server.inject({
      method: "GET",
      url: "/v1/version",
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as {
      protocol: string;
      version: string;
      releaseTag: string;
      contract: {
        name: string;
        version: string;
        releaseTag: string;
        wasmHash: string;
        specVersion: number;
        contractId: string;
        network: string;
        compatible: boolean;
      };
      features: string[];
    };

    assert.strictEqual(body.protocol, "STELLARCLEAR");
    assert.strictEqual(body.version, "0.1.0");
    assert.strictEqual(body.releaseTag, "v0.1.0");
    assert.strictEqual(body.contract.name, "settlement_registry");
    assert.strictEqual(body.contract.version, "0.1.1");
    assert.strictEqual(body.contract.specVersion, 1);
    assert.strictEqual(body.contract.compatible, true);
    assert.ok(body.features.includes("onchain_finalization"));
  });
});

