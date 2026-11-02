import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import {
  RpcClient,
  startIndexerWorker,
  loadIndexerConfigFromEnv,
} from "@stellarclear/indexer";

const RPC_PRIMARY = "https://rpc-primary.stellar.test";
const RPC_SECONDARY = "https://rpc-secondary.stellar.test";
const RPC_TERTIARY = "https://rpc-tertiary.stellar.test";

describe("Indexer Service - Multi-RPC Failover & Cursor Preservation", () => {
  it("initializes RpcClient with multiple endpoints and tracks active endpoint", () => {
    const client = new RpcClient({
      rpcUrls: [RPC_PRIMARY, RPC_SECONDARY, RPC_TERTIARY],
      failoverThreshold: 2,
    });

    assert.strictEqual(client.getActiveRpcUrl(), RPC_PRIMARY);
    assert.strictEqual(client.getActiveIndex(), 0);
    assert.deepStrictEqual(client.getEndpoints(), [RPC_PRIMARY, RPC_SECONDARY, RPC_TERTIARY]);

    const health = client.getEndpointsHealth();
    assert.strictEqual(health.length, 3);
    assert.strictEqual(health[0].isHealthy, true);
    assert.strictEqual(health[0].consecutiveFailures, 0);
  });

  it("automatically fails over to secondary RPC on error and preserves query parameters", async () => {
    let primaryCalls = 0;
    let secondaryCalls = 0;
    let receivedStartLedger: number | undefined;

    const mockServers: Record<string, any> = {
      [RPC_PRIMARY]: {
        getEvents: async (req: any) => {
          primaryCalls++;
          throw new Error("HTTP 429 Too Many Requests - rate limit exceeded");
        },
      },
      [RPC_SECONDARY]: {
        getEvents: async (req: any) => {
          secondaryCalls++;
          receivedStartLedger = req.startLedger;
          return {
            events: [
              {
                type: "contract",
                ledger: 1050,
                id: "0000001050-0001",
                contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
                pagingToken: "1050-1",
                inSuccessfulContractCall: true,
                txHash: "1111111111111111111111111111111111111111111111111111111111111111",
              },
            ],
            latestLedger: 1055,
          };
        },
      },
    };

    const client = new RpcClient({
      rpcUrls: [RPC_PRIMARY, RPC_SECONDARY],
      failoverThreshold: 1,
      serverFactory: (url) => mockServers[url],
    });

    assert.strictEqual(client.getActiveRpcUrl(), RPC_PRIMARY);

    const res = await client.getEvents({
      startLedger: 1050,
      filters: [{ type: "contract", contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"] }],
      limit: 50,
    });

    assert.strictEqual(primaryCalls, 1);
    assert.strictEqual(secondaryCalls, 1);
    assert.strictEqual(receivedStartLedger, 1050);
    assert.strictEqual(client.getActiveRpcUrl(), RPC_SECONDARY);
    assert.strictEqual(res.events.length, 1);

    const health = client.getEndpointsHealth();
    const primaryHealth = health.find((h) => h.url === RPC_PRIMARY);
    const secondaryHealth = health.find((h) => h.url === RPC_SECONDARY);
    assert.strictEqual(primaryHealth?.isHealthy, false);
    assert.strictEqual(primaryHealth?.consecutiveFailures, 1);
    assert.strictEqual(secondaryHealth?.isHealthy, true);
    assert.strictEqual(secondaryHealth?.consecutiveFailures, 0);
  });

  it("integrates with indexer worker: rollover without state corruption", async () => {
    const db = new InMemoryDatabaseClient();

    let primaryAttempts = 0;
    let secondaryAttempts = 0;

    const mockServers: Record<string, any> = {
      [RPC_PRIMARY]: {
        getEvents: async () => {
          primaryAttempts++;
          throw new Error("HTTP 503 Service Unavailable");
        },
      },
      [RPC_SECONDARY]: {
        getEvents: async (req: any) => {
          secondaryAttempts++;
          return {
            events: [],
            latestLedger: 2000,
          };
        },
      },
    };

    const mockRpcClient = new RpcClient({
      rpcUrls: [RPC_PRIMARY, RPC_SECONDARY],
      failoverThreshold: 1,
      serverFactory: (url) => mockServers[url],
    });

    const worker = await startIndexerWorker(
      {
        network: "testnet",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        rpcUrls: [RPC_PRIMARY, RPC_SECONDARY],
        pollIntervalMs: 100,
        startLedger: 1999,
      },
      db,
      mockRpcClient
    );

    assert.strictEqual(worker.getActiveRpcUrl(), RPC_PRIMARY);

    // Initial poll fails on primary, automatically switches to secondary
    const result = await worker.pollOnce();
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(primaryAttempts, 1);
    assert.strictEqual(secondaryAttempts, 1);
    assert.strictEqual(worker.getActiveRpcUrl(), RPC_SECONDARY);

    // Subsequent poll directly queries secondary
    await worker.pollOnce();
    assert.strictEqual(secondaryAttempts, 2);
    assert.strictEqual(worker.getActiveRpcUrl(), RPC_SECONDARY);

    // Health diagnostics check
    const health = worker.getRpcHealth();
    assert.strictEqual(health.length, 2);

    await worker.stop();
  });

  it("loads multiple RPC URLs from STELLAR_RPC_URLS environment variable", () => {
    const config = loadIndexerConfigFromEnv({
      STELLAR_RPC_URLS: "https://rpc1.example.com, https://rpc2.example.com, https://rpc3.example.com",
    });

    assert.deepStrictEqual(config.rpcUrls, [
      "https://rpc1.example.com",
      "https://rpc2.example.com",
      "https://rpc3.example.com",
    ]);
    assert.strictEqual(config.rpcUrl, "https://rpc1.example.com");
  });
});
