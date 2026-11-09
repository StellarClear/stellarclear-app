import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { rpc } from "@stellar/stellar-sdk";
import {
  RpcClient,
  startIndexerWorker,
  type RpcServerLike,
} from "@stellarclear/indexer";
import { InMemoryDatabaseClient } from "@stellarclear/db";

describe("Indexer Multi-RPC Failover & Resiliency (Wave Issue #41)", () => {
  it("initializes RpcClient with multiple endpoints and tracks active endpoint", () => {
    const client = new RpcClient({
      rpcUrls: [
        "https://soroban-rpc-primary.stellar.org",
        "https://soroban-rpc-backup1.stellar.org",
        "https://soroban-rpc-backup2.stellar.org",
      ],
      maxConsecutiveFailuresBeforeFailover: 1,
    });

    assert.strictEqual(client.getActiveRpcUrl(), "https://soroban-rpc-primary.stellar.org");
    assert.strictEqual(client.getActiveIndex(), 0);
    assert.deepStrictEqual(client.getEndpoints(), [
      "https://soroban-rpc-primary.stellar.org",
      "https://soroban-rpc-backup1.stellar.org",
      "https://soroban-rpc-backup2.stellar.org",
    ]);

    const diagnostics = client.getHealthDiagnostics();
    assert.strictEqual(diagnostics.totalEndpoints, 3);
    assert.strictEqual(diagnostics.endpoints.length, 3);
    assert.strictEqual(diagnostics.endpoints[0]?.healthy, true);
  });

  it("fails over automatically to secondary RPC when primary encounters rate limit (HTTP 429)", async () => {
    let primaryCalls = 0;
    let secondaryCalls = 0;

    const mockServers: Record<string, RpcServerLike> = {
      "https://rpc-primary.org": {
        getEvents: async () => {
          primaryCalls++;
          throw new Error("HTTP 429: Too Many Requests (Rate limit exceeded)");
        },
      },
      "https://rpc-secondary.org": {
        getEvents: async (req) => {
          secondaryCalls++;
          return {
            events: [],
            latestLedger: (req.startLedger ?? 100) + 5,
          } as unknown as rpc.Api.GetEventsResponse;
        },
      },
    };

    const client = new RpcClient({
      rpcUrls: ["https://rpc-primary.org", "https://rpc-secondary.org"],
      maxConsecutiveFailuresBeforeFailover: 1,
      serverFactory: (url) => mockServers[url]!,
    });

    assert.strictEqual(client.getActiveRpcUrl(), "https://rpc-primary.org");

    // Execute getEvents: primary will fail with 429, client will auto-failover to secondary and succeed
    const res = await client.getEvents({
      startLedger: 500,
      filters: [{ type: "contract", contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"] }],
    });

    assert.ok(res);
    assert.strictEqual(primaryCalls, 1);
    assert.strictEqual(secondaryCalls, 1);
    assert.strictEqual(client.getActiveRpcUrl(), "https://rpc-secondary.org");
    assert.strictEqual(client.getActiveIndex(), 1);

    const diag = client.getHealthDiagnostics();
    const primaryHealth = diag.endpoints.find((e) => e.url === "https://rpc-primary.org")!;
    const secondaryHealth = diag.endpoints.find((e) => e.url === "https://rpc-secondary.org")!;

    assert.strictEqual(primaryHealth.healthy, false);
    assert.strictEqual(primaryHealth.totalErrors, 1);
    assert.ok(primaryHealth.lastError?.includes("429"));

    assert.strictEqual(secondaryHealth.healthy, true);
    assert.strictEqual(secondaryHealth.totalCalls, 1);
    assert.strictEqual(secondaryHealth.totalErrors, 0);
  });

  it("maintains cursor consistency across provider failover without event loss", async () => {
    const receivedStartLedgers: number[] = [];

    const mockServers: Record<string, RpcServerLike> = {
      "https://rpc-1.org": {
        getEvents: async (req) => {
          receivedStartLedgers.push(req.startLedger ?? 0);
          throw new Error("HTTP 503: Service Unavailable");
        },
      },
      "https://rpc-2.org": {
        getEvents: async (req) => {
          receivedStartLedgers.push(req.startLedger ?? 0);
          return {
            events: [],
            latestLedger: (req.startLedger ?? 0) + 10,
          } as unknown as rpc.Api.GetEventsResponse;
        },
      },
    };

    const client = new RpcClient({
      rpcUrls: ["https://rpc-1.org", "https://rpc-2.org"],
      serverFactory: (url) => mockServers[url]!,
    });

    // Execute call with startLedger 12345
    await client.getEvents({
      startLedger: 12345,
      filters: [{ type: "contract", contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"] }],
    });

    // Both primary attempt and fallback attempt must have received the EXACT same startLedger
    assert.deepStrictEqual(receivedStartLedgers, [12345, 12345]);
  });

  it("integrates with IndexerWorkerInstance and exposes health diagnostics", async () => {
    const db = new InMemoryDatabaseClient();

    let server1Calls = 0;
    let server2Calls = 0;

    const mockServers: Record<string, RpcServerLike> = {
      "https://node1.stellar.local": {
        getEvents: async () => {
          server1Calls++;
          throw new Error("502 Bad Gateway");
        },
      },
      "https://node2.stellar.local": {
        getEvents: async () => {
          server2Calls++;
          return {
            events: [],
            latestLedger: 1000,
          } as unknown as rpc.Api.GetEventsResponse;
        },
      },
    };

    const worker = await startIndexerWorker(
      {
        network: "testnet",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        rpcUrls: ["https://node1.stellar.local", "https://node2.stellar.local"],
        pollIntervalMs: 50,
        rpcServerFactory: (url) => mockServers[url]!,
      },
      db
    );

    assert.strictEqual(worker.rpcClient.getActiveRpcUrl(), "https://node1.stellar.local");

    // Execute poll: node1 will fail, worker fails over to node2, succeeds
    const result = await worker.pollOnce();
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(server1Calls, 1);
    assert.strictEqual(server2Calls, 1);

    const diagnostics = worker.getDiagnostics();
    assert.strictEqual(diagnostics.activeRpcUrl, "https://node2.stellar.local");
    assert.strictEqual(diagnostics.activeRpcIndex, 1);
    assert.strictEqual(diagnostics.rpc.endpoints.length, 2);
    assert.strictEqual(diagnostics.rpc.endpoints[0]?.healthy, false);
    assert.strictEqual(diagnostics.rpc.endpoints[1]?.healthy, true);

    await worker.stop();
  });
});
