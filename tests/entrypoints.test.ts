import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  loadApiConfigFromEnv,
  startApiServer,
} from "@stellarclear/api";
import {
  loadIndexerConfigFromEnv,
  startIndexerWorker,
} from "@stellarclear/indexer";
import { InMemoryDatabaseClient } from "@stellarclear/db";

describe("Standalone Service Entrypoints", () => {
  describe("API Service Entrypoint", () => {
    it("loads API config from environment variables and defaults", () => {
      const originalPort = process.env["API_PORT"];
      const originalHost = process.env["API_HOST"];
      try {
        process.env["API_PORT"] = "4000";
        process.env["API_HOST"] = "127.0.0.1";
        const config = loadApiConfigFromEnv();
        assert.strictEqual(config.port, 4000);
        assert.strictEqual(config.host, "127.0.0.1");
        assert.ok(config.network);
        assert.ok(config.contractId);
      } finally {
        if (originalPort !== undefined) {
          process.env["API_PORT"] = originalPort;
        } else {
          delete process.env["API_PORT"];
        }
        if (originalHost !== undefined) {
          process.env["API_HOST"] = originalHost;
        } else {
          delete process.env["API_HOST"];
        }
      }
    });

    it("starts and stops standalone API HTTP server cleanly", async () => {
      const db = new InMemoryDatabaseClient();
      const handle = await startApiServer(
        {
          port: 0, // OS assigned ephemeral port
          host: "127.0.0.1",
          network: "testnet",
          contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
        },
        db
      );

      try {
        const addr = handle.server.address();
        assert.ok(addr && typeof addr === "object");
        const port = addr.port;

        // Perform HTTP GET request to /health
        const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${port}/health`, (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => resolve({ statusCode: res.statusCode || 0, body: data }));
            })
            .on("error", reject);
        });

        assert.strictEqual(res.statusCode, 200);
        const parsed = JSON.parse(res.body);
        assert.strictEqual(parsed.status, "ok");
        assert.strictEqual(parsed.version, "0.1.0");
      } finally {
        await handle.stop();
      }
    });
  });

  describe("Indexer Worker Entrypoint", () => {
    it("loads Indexer config from environment variables and defaults", () => {
      const originalInterval = process.env["INDEXER_POLL_INTERVAL_MS"];
      const originalBatch = process.env["INDEXER_BATCH_SIZE"];
      try {
        process.env["INDEXER_POLL_INTERVAL_MS"] = "2500";
        process.env["INDEXER_BATCH_SIZE"] = "50";
        const config = loadIndexerConfigFromEnv();
        assert.strictEqual(config.pollIntervalMs, 2500);
        assert.strictEqual(config.batchSize, 50);
        assert.ok(config.rpcUrl);
        assert.ok(config.contractId);
      } finally {
        if (originalInterval !== undefined) {
          process.env["INDEXER_POLL_INTERVAL_MS"] = originalInterval;
        } else {
          delete process.env["INDEXER_POLL_INTERVAL_MS"];
        }
        if (originalBatch !== undefined) {
          process.env["INDEXER_BATCH_SIZE"] = originalBatch;
        } else {
          delete process.env["INDEXER_BATCH_SIZE"];
        }
      }
    });

    it("initializes and stops standalone Indexer worker cleanly", async () => {
      const db = new InMemoryDatabaseClient();
      const handle = await startIndexerWorker(
        {
          pollIntervalMs: 60000, // large interval so test finishes before tick
          batchSize: 10,
          rpcUrl: "https://soroban-testnet.stellar.org",
          contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
        },
        db
      );

      assert.ok(handle.service);
      assert.ok(handle.dbClient);

      // Verify clean shutdown
      await handle.stop();
    });
  });
});
