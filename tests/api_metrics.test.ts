import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import { createApiServer, SorobanSettlementAnchor } from "@stellarclear/api";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";
const VALID_OWNER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYORMA3Y4H3EL2PUGQY";
const VALID_DESTINATION = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const VALID_ASSET = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("API Service - Prometheus Metrics Telemetry (/metrics)", () => {
  it("exposes GET /metrics with text/plain content-type and valid Prometheus exposition format", async () => {
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
      url: "/metrics",
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers["content-type"]?.includes("text/plain"));
    const metrics = typeof res.body === "string" ? res.body : String(res.body);

    // Verify presence of standard Prometheus exposition declarations
    assert.ok(metrics.includes("# HELP stellarclear_cases_total"));
    assert.ok(metrics.includes("# TYPE stellarclear_cases_total counter"));
    assert.ok(metrics.includes('stellarclear_cases_total{status="OPEN"} 0'));

    assert.ok(metrics.includes("# HELP stellarclear_settlements_matched_total"));
    assert.ok(metrics.includes("# TYPE stellarclear_settlements_matched_total counter"));

    assert.ok(metrics.includes("# HELP stellarclear_breaks_classified_total"));
    assert.ok(metrics.includes("# TYPE stellarclear_breaks_classified_total counter"));

    assert.ok(metrics.includes("# HELP stellarclear_disputes_active_total"));
    assert.ok(metrics.includes("# TYPE stellarclear_disputes_active_total gauge"));

    assert.ok(metrics.includes("# HELP stellarclear_database_connection_pool_status"));
    assert.ok(metrics.includes("# TYPE stellarclear_database_connection_pool_status gauge"));
    assert.ok(metrics.includes("stellarclear_database_connection_pool_status 1"));

    assert.ok(metrics.includes("# HELP stellarclear_ledger_sync_cursor_lag"));
    assert.ok(metrics.includes("# TYPE stellarclear_ledger_sync_cursor_lag gauge"));

    assert.ok(metrics.includes("# HELP stellarclear_api_uptime_seconds"));
    assert.ok(metrics.includes("# TYPE stellarclear_api_uptime_seconds gauge"));
  });

  it("updates counters and gauges dynamically as settlement cases and breaks are created", async () => {
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

    // Create a case
    const caseId = "1111111111111111111111111111111111111111111111111111111111111111";
    const terms = {
      caseId,
      tradeReference: "TR-METRICS-001",
      owner: VALID_OWNER,
      counterparty: VALID_DESTINATION,
      amount: "100.0000000",
      asset: VALID_ASSET,
      expectedDestination: VALID_DESTINATION,
      deadline: 600000,
    };

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // Check metrics reflect 1 open case
    let res = await server.inject({ method: "GET", url: "/metrics" });
    let metrics = String(res.body);
    assert.ok(metrics.includes('stellarclear_cases_total{status="OPEN"} 1'));

    // Record mismatched observation resulting in BREAK
    const observation = {
      txHash: "0x_mismatch_tx",
      ledger: 500000,
      observedAt: new Date().toISOString(),
      amount: "50.0000000", // Mismatched amount
      asset: VALID_ASSET,
      destination: VALID_DESTINATION,
      status: "SUCCESS" as const,
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

    // Check metrics reflect 1 broken case
    res = await server.inject({ method: "GET", url: "/metrics" });
    metrics = String(res.body);
    assert.ok(metrics.includes('stellarclear_cases_total{status="BREAK"} 1'));
    assert.ok(metrics.includes("stellarclear_breaks_classified_total 1"));
  });
});
