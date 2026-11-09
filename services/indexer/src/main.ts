import { fileURLToPath } from "node:url";
import { createDatabaseClient, type IDatabaseClient } from "@stellarclear/db";
import { IndexerService, type IndexerConfig } from "./service.js";
import type { RawStellarEvent } from "./decoder.js";
import { startEventStreamServer, type EventStreamServer } from "./ws-server.js";
import { RpcClient, type IndexerRpcDiagnostics, type RpcServerLike } from "./rpc-client.js";

export interface IndexerWorkerConfig extends IndexerConfig {
  /** Primary RPC endpoint URL. For multiple endpoints, use rpcUrls. */
  rpcUrl?: string;
  /** Configured Soroban RPC endpoints for resilient failover. */
  rpcUrls?: string[];
  databaseUrl: string;
  pollIntervalMs: number;
  startLedger?: number;
  /** When set, serves the realtime WebSocket event stream on this port. */
  streamPort?: number;
  streamHost?: string;
  streamAuthToken?: string;
  /** Base delay in ms for exponential backoff on RPC error (default 1000ms). */
  backoffBaseMs?: number;
  /** Maximum backoff ceiling in ms on continuous RPC error (default 60000ms). */
  maxBackoffMs?: number;
  /** Random jitter factor between 0.0 and 1.0 (default 0.25). */
  jitterFactor?: number;
  /** Maximum consecutive failures on an endpoint before triggering failover (default: 1). */
  maxFailuresBeforeFailover?: number;
  /** Optional custom factory to instantiate RPC server instances (useful for testing/mocking). */
  rpcServerFactory?: (url: string) => RpcServerLike;
}

/**
 * Calculates exponential backoff with randomized jitter according to:
 * min(maxBackoffMs, baseMs * 2^(attempt - 1) + jitter)
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseMs = 1000,
  maxBackoffMs = 60000,
  jitterFactor = 0.25,
  randomFn: () => number = Math.random
): number {
  if (attempt <= 0) return 0;
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(maxBackoffMs, exponential);
  const jitter = capped * jitterFactor * randomFn();
  return Math.min(maxBackoffMs, Math.floor(capped + jitter));
}

export interface IndexerHealthDiagnostics {
  activeRpcUrl: string;
  activeRpcIndex: number;
  cursor: {
    ledger: number;
    eventCursor: string | null;
  };
  consecutiveFailures: number;
  rpc: IndexerRpcDiagnostics;
}

export interface IndexerWorkerInstance {
  service: IndexerService;
  dbClient: IDatabaseClient;
  config: IndexerWorkerConfig;
  rpcClient: RpcClient;
  getDiagnostics: () => IndexerHealthDiagnostics;
  streamServer?: EventStreamServer;
  pollOnce: () => Promise<{ ingestedCount: number; skippedCount: number; errors: string[] }>;
  stop: () => Promise<void>;
}

export function loadIndexerConfigFromEnv(
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {})
): IndexerWorkerConfig {
  const batchStr = env["INDEXER_BATCH_SIZE"] || env["BATCH_SIZE"];
  const rpcUrlsEnv = env["STELLAR_RPC_URLS"];
  const defaultRpcUrl = env["STELLAR_RPC_URL"] || "https://soroban-testnet.stellar.org";
  const rpcUrls = rpcUrlsEnv
    ? rpcUrlsEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : [defaultRpcUrl];

  return {
    network: env["STELLAR_NETWORK"] || "testnet",
    contractId:
      env["STELLAR_CONTRACT_ID"] ||
      "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
    rpcUrl: rpcUrls[0] || defaultRpcUrl,
    rpcUrls,
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
    backoffBaseMs: env["INDEXER_BACKOFF_BASE_MS"]
      ? parseInt(env["INDEXER_BACKOFF_BASE_MS"], 10)
      : 1000,
    maxBackoffMs: env["INDEXER_MAX_BACKOFF_MS"]
      ? parseInt(env["INDEXER_MAX_BACKOFF_MS"], 10)
      : 60000,
    jitterFactor: env["INDEXER_JITTER_FACTOR"]
      ? parseFloat(env["INDEXER_JITTER_FACTOR"])
      : 0.25,
    maxFailuresBeforeFailover: env["INDEXER_MAX_FAILOVER_FAILURES"]
      ? parseInt(env["INDEXER_MAX_FAILOVER_FAILURES"], 10)
      : 1,
  };
}

/**
 * Starts the standalone StellarClear Indexer event ingestion worker with multi-RPC failover support.
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

  const configuredUrls =
    config.rpcUrls && config.rpcUrls.length > 0
      ? config.rpcUrls
      : [config.rpcUrl || "https://soroban-testnet.stellar.org"];

  const rpcClient = new RpcClient({
    rpcUrls: configuredUrls,
    maxConsecutiveFailuresBeforeFailover: config.maxFailuresBeforeFailover ?? 1,
    serverFactory: config.rpcServerFactory,
  });

  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let isPolling = false;
  let consecutiveFailures = 0;
  let currentDelayMs = config.pollIntervalMs;

  const pollOnce = async (): Promise<{
    ingestedCount: number;
    skippedCount: number;
    errors: string[];
  }> => {
    try {
      const currentCursor = service.cursor;
      const startLedger = currentCursor.ledger > 0 ? currentCursor.ledger : (config.startLedger ?? 1);

      const response = await rpcClient.getEvents({
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
          `[StellarClear Indexer] Ingested ${result.ingestedCount} events (Ledger: ${service.cursor.ledger}, RPC: ${rpcClient.getActiveRpcUrl()})`
        );
      }

      // Successful RPC query and ingestion: Reset backoff to normal polling
      if (consecutiveFailures > 0) {
        console.log(
          `[StellarClear Indexer] RPC recovered successfully after ${consecutiveFailures} consecutive failure(s). Resetting poll interval to ${config.pollIntervalMs}ms.`
        );
        consecutiveFailures = 0;
      }
      currentDelayMs = config.pollIntervalMs;

      return result;
    } catch (err: unknown) {
      const msg = (err as Error).message || "Unknown RPC error";
      consecutiveFailures++;
      currentDelayMs = calculateBackoffWithJitter(
        consecutiveFailures,
        config.backoffBaseMs ?? 1000,
        config.maxBackoffMs ?? 60000,
        config.jitterFactor ?? 0.25
      );
      console.warn(
        `[StellarClear Indexer] RPC failure (attempt ${consecutiveFailures}, active: ${rpcClient.getActiveRpcUrl()}): ${msg}. Backing off for ${currentDelayMs}ms before retry.`
      );
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
    }, currentDelayMs);
  };

  console.log(
    `[StellarClear Indexer] Started worker for contract ${config.contractId} on ${config.network} (Polling: ${config.pollIntervalMs}ms, RPCs: ${configuredUrls.length})`
  );

  // Initial trigger
  scheduleNext();

  const getDiagnostics = (): IndexerHealthDiagnostics => ({
    activeRpcUrl: rpcClient.getActiveRpcUrl(),
    activeRpcIndex: rpcClient.getActiveIndex(),
    cursor: service.cursor,
    consecutiveFailures,
    rpc: rpcClient.getHealthDiagnostics(),
  });

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

  return { service, dbClient, config, rpcClient, getDiagnostics, streamServer, pollOnce, stop };
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
