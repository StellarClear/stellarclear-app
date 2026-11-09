import { rpc } from "@stellar/stellar-sdk";

export interface RpcEndpointHealth {
  url: string;
  healthy: boolean;
  consecutiveFailures: number;
  totalCalls: number;
  totalErrors: number;
  lastError?: string;
  lastSuccessAt?: number;
  lastErrorAt?: number;
}

export interface RpcClientOptions {
  /** Configured Soroban RPC endpoints in priority order */
  rpcUrls: string[];
  /** Consecutive failures on an endpoint before failing over to the next (default: 1) */
  maxConsecutiveFailuresBeforeFailover?: number;
  /** Request timeout for individual RPC call in ms (default: 30000) */
  requestTimeoutMs?: number;
  /** Custom factory to create rpc.Server instance (useful for testing/mocking) */
  serverFactory?: (url: string) => RpcServerLike;
}

export interface RpcServerLike {
  getEvents(request: rpc.Server.GetEventsRequest): Promise<rpc.Api.GetEventsResponse>;
}

export interface IndexerRpcDiagnostics {
  activeRpcUrl: string;
  activeRpcIndex: number;
  totalEndpoints: number;
  endpoints: RpcEndpointHealth[];
}

export class RpcClient {
  private readonly endpoints: string[];
  private currentIndex: number = 0;
  private readonly healthMap: Map<string, RpcEndpointHealth> = new Map();
  private readonly serverCache: Map<string, RpcServerLike> = new Map();
  private readonly maxFailures: number;
  private readonly serverFactory: (url: string) => RpcServerLike;

  constructor(options: RpcClientOptions | string | string[]) {
    let urls: string[];
    let maxFailures = 1;
    let factory: ((url: string) => RpcServerLike) | undefined;

    if (typeof options === "string") {
      urls = [options];
    } else if (Array.isArray(options)) {
      urls = options;
    } else {
      urls = options.rpcUrls;
      maxFailures = options.maxConsecutiveFailuresBeforeFailover ?? 1;
      factory = options.serverFactory;
    }

    const filtered = (urls || []).map((u) => u.trim()).filter(Boolean);
    if (filtered.length === 0) {
      throw new Error("RpcClient requires at least one non-empty RPC endpoint URL.");
    }

    this.endpoints = filtered;
    this.maxFailures = Math.max(1, maxFailures);
    this.serverFactory =
      factory ??
      ((url: string) =>
        new rpc.Server(url, {
          allowHttp: url.startsWith("http://"),
        }));

    for (const url of this.endpoints) {
      this.healthMap.set(url, {
        url,
        healthy: true,
        consecutiveFailures: 0,
        totalCalls: 0,
        totalErrors: 0,
      });
    }
  }

  public getActiveRpcUrl(): string {
    return this.endpoints[this.currentIndex];
  }

  public getActiveIndex(): number {
    return this.currentIndex;
  }

  public getEndpoints(): string[] {
    return [...this.endpoints];
  }

  public getHealthDiagnostics(): IndexerRpcDiagnostics {
    return {
      activeRpcUrl: this.getActiveRpcUrl(),
      activeRpcIndex: this.currentIndex,
      totalEndpoints: this.endpoints.length,
      endpoints: this.endpoints.map((url) => ({ ...this.healthMap.get(url)! })),
    };
  }

  private getServer(url: string): RpcServerLike {
    let server = this.serverCache.get(url);
    if (!server) {
      server = this.serverFactory(url);
      this.serverCache.set(url, server);
    }
    return server;
  }

  /**
   * Switches to the next available endpoint in the list.
   */
  public failover(reason?: string): string {
    const previous = this.getActiveRpcUrl();
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    const current = this.getActiveRpcUrl();
    console.warn(
      `[StellarClear RpcClient] Failover triggered: switching from ${previous} to ${current}${
        reason ? ` (Reason: ${reason})` : ""
      }`
    );
    return current;
  }

  /**
   * Sets the active endpoint index directly.
   */
  public setActiveIndex(index: number): void {
    if (index < 0 || index >= this.endpoints.length) {
      throw new RangeError(`Index ${index} out of range [0, ${this.endpoints.length - 1}]`);
    }
    this.currentIndex = index;
  }

  /**
   * Executes getEvents with automatic health tracking and endpoint failover.
   * If the current RPC endpoint fails (e.g. rate-limit HTTP 429, 502/503, connection refused),
   * marks it unhealthy, fails over to the next configured endpoint, and retries.
   */
  public async getEvents(
    request: rpc.Server.GetEventsRequest
  ): Promise<rpc.Api.GetEventsResponse> {
    const maxAttempts = this.endpoints.length;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const currentUrl = this.getActiveRpcUrl();
      const health = this.healthMap.get(currentUrl)!;
      health.totalCalls++;

      try {
        const server = this.getServer(currentUrl);
        const response = await server.getEvents(request);

        // Success: record healthy state
        health.healthy = true;
        health.consecutiveFailures = 0;
        health.lastSuccessAt = Date.now();

        return response;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        health.consecutiveFailures++;
        health.totalErrors++;
        health.lastError = error.message;
        health.lastErrorAt = Date.now();

        if (health.consecutiveFailures >= this.maxFailures) {
          health.healthy = false;
        }

        // Only attempt failover if multiple endpoints are configured
        if (this.endpoints.length > 1) {
          this.failover(error.message);
        } else {
          // Single endpoint: cannot failover, propagate error
          throw error;
        }
      }
    }

    // If all endpoints failed in this attempt cycle, rethrow the last encountered error
    throw lastError ?? new Error("All configured RPC endpoints failed to respond.");
  }
}
