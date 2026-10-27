import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateBackoffWithJitter, startIndexerWorker } from "@stellarclear/indexer";
import { InMemoryDatabaseClient } from "@stellarclear/db";

describe("Indexer Service - Exponential Backoff and Jitter (TASK RPC-Recovery)", () => {
  it("calculates exponential backoff correctly across progressive failure attempts", () => {
    // With zero jitter (randomFn returning 0)
    const zeroJitter = () => 0;
    assert.strictEqual(calculateBackoffWithJitter(0, 1000, 60000, 0.25, zeroJitter), 0);
    assert.strictEqual(calculateBackoffWithJitter(1, 1000, 60000, 0.25, zeroJitter), 1000);
    assert.strictEqual(calculateBackoffWithJitter(2, 1000, 60000, 0.25, zeroJitter), 2000);
    assert.strictEqual(calculateBackoffWithJitter(3, 1000, 60000, 0.25, zeroJitter), 4000);
    assert.strictEqual(calculateBackoffWithJitter(4, 1000, 60000, 0.25, zeroJitter), 8000);
    assert.strictEqual(calculateBackoffWithJitter(5, 1000, 60000, 0.25, zeroJitter), 16000);
    assert.strictEqual(calculateBackoffWithJitter(6, 1000, 60000, 0.25, zeroJitter), 32000);
    // At attempt 7: 1000 * 2^6 = 64000, capped at maxBackoffMs = 60000
    assert.strictEqual(calculateBackoffWithJitter(7, 1000, 60000, 0.25, zeroJitter), 60000);
    assert.strictEqual(calculateBackoffWithJitter(10, 1000, 60000, 0.25, zeroJitter), 60000);
  });

  it("applies bounded jitter correctly within the configured jitter factor", () => {
    const fullJitter = () => 1.0;
    // Attempt 1: 1000 + 1000 * 0.25 * 1.0 = 1250
    assert.strictEqual(calculateBackoffWithJitter(1, 1000, 60000, 0.25, fullJitter), 1250);
    // Attempt 2: 2000 + 2000 * 0.25 * 1.0 = 2500
    assert.strictEqual(calculateBackoffWithJitter(2, 1000, 60000, 0.25, fullJitter), 2500);

    // With real Math.random, result is bounded between base and base * (1 + factor)
    for (let i = 0; i < 20; i++) {
      const val = calculateBackoffWithJitter(1, 1000, 60000, 0.25);
      assert.ok(val >= 1000 && val <= 1250, `Backoff ${val} out of expected range [1000, 1250]`);
    }
  });

  it("handles RPC errors gracefully during worker poll without throwing unhandled exceptions", async () => {
    const db = new InMemoryDatabaseClient();
    const worker = await startIndexerWorker(
      {
        network: "testnet",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        rpcUrl: "http://127.0.0.1:59999/non-existent-rpc", // Will trigger connection error
        pollIntervalMs: 50,
        backoffBaseMs: 100,
        maxBackoffMs: 1000,
      },
      db
    );

    // pollOnce catches the RPC error, logs warning, and returns clean error summary
    const res = await worker.pollOnce();
    assert.strictEqual(res.ingestedCount, 0);
    assert.strictEqual(res.skippedCount, 0);
    assert.strictEqual(res.errors.length, 1);
    assert.ok(res.errors[0]?.length > 0);

    await worker.stop();
  });
});

