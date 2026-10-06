import { fileURLToPath } from "node:url";
import { rpc } from "@stellar/stellar-sdk";
import { createDatabaseClient, type IDatabaseClient } from "@stellarclear/db";
import { IndexerService, type IndexerConfig } from "./service.js";
import type { RawStellarEvent } from "./decoder.js";
import { startEventStreamServer, type EventStreamServer } from "./ws-server.js";

export interface IndexerWorkerConfig extends IndexerConfig {
  rpcUrl: string;
  databaseUrl: string;
  pollIntervalMs: number;
  startLedger?: number;
  /** When set, serves the realtime WebSocket event stream on this port. */
  streamPort?: number;
  streamHost?: string;
  streamAuthToken?: string;
}

export interface IndexerWorkerInstance {
  service: IndexerService;
  dbClient: IDatabaseClient;
  config: IndexerWorkerConfig;
  streamServer?: EventStreamServer;
  pollOnce: () => Promise<{ ingestedCount: number; skippedCount: number; errors: string[] }>;
  stop: () => Promise<void>;
}

export function loadIndexerConfigFromEnv(
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {})
): IndexerWorkerConfig {
  const batchStr = env["INDEXER_BATCH_SIZE"] || env["BATCH_SIZE"];
  return {
    network: env["STELLAR_NETWORK"] || "testnet",
    contractId:
      env["STELLAR_CONTRACT_ID"] ||
      "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
    rpcUrl: env["STELLAR_RPC_URL"] || "https://soroban-testnet.stellar.org",
    databaseUrl: env["DATABASE_URL"] || "postgres://localhost:5432/stellarclear_db",
    pollIntervalMs: env["INDEXER_POLL_INTERVAL_MS"]
      ? parseInt(env["INDEXER_POLL_INTERVAL_MS"], 10)
      : 5000,
    batchSize: batchStr ? parseInt(batchStr, 10) : 100,
    startLedger: env["START_LEDGER"] ? parseInt(env["START_LEDGER"], 10) : undefined,
    streamPort: env["INDEXER_STREAM_PORT"] ? parseInt(env["INDEXER_STREAM_PORT"], 10) : undefined,
    streamHost: env["INDEXER_STREAM_HOST"] || undefined,
    streamAuthToken: env["INDEXER_STREAM_AUTH_TOKEN"] || undefined,
    streamBufferSize: env["INDEXER_STREAM_BUFFER_SIZE"]
      ? parseInt(env["INDEXER_STREAM_BUFFER_SIZE"], 10)
      : undefined,
  };
}

/**
 * Starts the standalone StellarClear Indexer event ingestion worker.
 */
export async function startIndexerWorker(
  customConfig?: Partial<IndexerWorkerConfig>,
  customDbClient?: IDatabaseClient
): Promise<IndexerWorkerInstance> {
  const envConfig = loadIndexerConfigFromEnv(process.env);
  const config: IndexerWorkerConfig = { ...envConfig, ...customConfig };

  const dbClient = customDbClient ?? createDatabaseClient({ databaseUrl: config.databaseUrl });
  const service = new IndexerService(dbClient, config);
  await service.init();

  let streamServer: EventStreamServer | undefined;
  if (config.streamPort !== undefined) {
    streamServer = await startEventStreamServer({
      stream: service.stream,
      durable: service.durableReplay,
      network: config.network,
      contractId: config.contractId,
      port: config.streamPort,
      host: config.streamHost,
      authToken: config.streamAuthToken,
    });
    console.log(`[StellarClear Indexer] Realtime event stream listening on port ${streamServer.port}`);
  }

  const rpcServer = new rpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });

  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let isPolling = false;

  const pollOnce = async (): Promise<{
    ingestedCount: number;
    skippedCount: number;
    errors: string[];
  }> => {
    try {
      const currentCursor = service.cursor;
      let startLedger = currentCursor.ledger > 0 ? currentCursor.ledger : (config.startLedger ?? 1);

      const response = await rpcServer.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [config.contractId] }],
        limit: config.batchSize,
      });

      const rawEvents: RawStellarEvent[] = (response.events || []).map((e: unknown) => {
        const raw = e as Record<string, unknown>;
        return {
          type: String(raw["type"] || "contract"),
          ledger: Number(raw["ledger"] || 0),
          ledgerClosedAt: raw["ledgerClosedAt"] ? String(raw["ledgerClosedAt"]) : undefined,
          contractId: String(raw["contractId"] || config.contractId),
          id: String(raw["id"] || ""),
          pagingToken: raw["pagingToken"] ? String(raw["pagingToken"]) : undefined,
          inSuccessfulContractCall: Boolean(raw["inSuccessfulContractCall"]),
          txHash: raw["txHash"] ? String(raw["txHash"]) : undefined,
          topic: raw["topic"] as unknown[] | undefined,
          value: raw["value"],
        };
      });

      const result = await service.ingestBatch(rawEvents);
      if (result.ingestedCount > 0) {
        console.log(
          `[StellarClear Indexer] Ingested ${result.ingestedCount} events (Ledger: ${service.cursor.ledger})`
        );
      }
      return result;
    } catch (err: unknown) {
      const msg = (err as Error).message || "Unknown RPC error";
      console.warn(`[StellarClear Indexer] Event polling warning: ${msg}`);
      return { ingestedCount: 0, skippedCount: 0, errors: [msg] };
    }
  };

  const scheduleNext = () => {
    if (!running) return;
    timer = setTimeout(async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        await pollOnce();
      } finally {
        isPolling = false;
        scheduleNext();
      }
    }, config.pollIntervalMs);
  };

  console.log(
    `[StellarClear Indexer] Started worker for contract ${config.contractId} on ${config.network} (Polling: ${config.pollIntervalMs}ms)`
  );

  // Initial trigger
  scheduleNext();

  const stop = async () => {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await streamServer?.close();
    await dbClient.close();
    console.log("[StellarClear Indexer] Worker stopped.");
  };

  return { service, dbClient, config, streamServer, pollOnce, stop };
}

// Auto-start when executed directly as entrypoint
const isDirectEntry =
  process.argv[1] &&
  (process.argv[1].endsWith("main.js") ||
    process.argv[1].endsWith("main.ts") ||
    process.argv[1] === fileURLToPath(import.meta.url));

if (isDirectEntry) {
  startIndexerWorker()
    .then((instance) => {
      const handleSignal = async (signal: string) => {
        console.log(`[StellarClear Indexer] Received ${signal}, shutting down gracefully...`);
        await instance.stop();
        process.exit(0);
      };
      process.on("SIGINT", () => handleSignal("SIGINT"));
      process.on("SIGTERM", () => handleSignal("SIGTERM"));
    })
    .catch((err) => {
      console.error("[StellarClear Indexer] Failed to start:", err);
      process.exit(1);
    });
}
