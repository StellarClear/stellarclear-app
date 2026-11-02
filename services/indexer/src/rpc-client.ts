import { rpc } from "@stellar/stellar-sdk";

export interface RpcEndpointHealth {
  url: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalRequests: number;
  totalFailures: number;
}

export interface RpcClientOptions {
  rpcUrls: string[];
  failoverThreshold?: number;
  allowHttp?: boolean;
  serverFactory?: (url: string) => {
    getEvents: (request: rpc.Api.GetEventsRequest) => Promise<rpc.Api.GetEventsResponse>;
  };
}

/**
 * Resilient multi-RPC client for Soroban event ingestion with health-aware failover.
 * Automatically rotates to backup RPC endpoints upon rate-limiting (429) or transient downtime (502/503),
 * preserving cursor and startLedger consistency with zero dropped events.
 */
export class RpcClient {
  private readonly endpoints: string[];
  private activeIndex = 0;
  private readonly servers = new Map<
    string,
    { getEvents: (request: rpc.Api.GetEventsRequest) => Promise<rpc.Api.GetEventsResponse> }
  >();
  private readonly health = new Map<string, RpcEndpointHealth>();
  private readonly failoverThreshold: number;

  constructor(options: RpcClientOptions) {
    if (!options.rpcUrls || options.rpcUrls.length === 0) {
      throw new Error("RpcClient requires at least one configured RPC endpoint URL");
    }

    this.endpoints = [...options.rpcUrls.map((u) => u.trim()).filter((u) => u.length > 0)];
    if (this.endpoints.length === 0) {
      throw new Error("RpcClient requires at least one non-empty RPC endpoint URL");
    }

    this.failoverThreshold = options.failoverThreshold ?? 1;

    for (const url of this.endpoints) {
      this.health.set(url, {
        url,
        isHealthy: true,
        consecutiveFailures: 0,
        totalRequests: 0,
        totalFailures: 0,
      });

      if (options.serverFactory) {
        this.servers.set(url, options.serverFactory(url));
      } else {
        const server = new rpc.Server(url, {
          allowHttp: options.allowHttp ?? url.startsWith("http://"),
        });
        this.servers.set(url, server);
      }
    }
  }

  /**
   * Returns the currently active RPC endpoint URL.
   */
  public getActiveRpcUrl(): string {
    return this.endpoints[this.activeIndex]!;
  }

  /**
   * Returns index of the active RPC endpoint.
   */
  public getActiveIndex(): number {
    return this.activeIndex;
  }

  /**
   * Returns all configured RPC endpoint URLs.
   */
  public getEndpoints(): string[] {
    return [...this.endpoints];
  }

  /**
   * Returns detailed health diagnostic snapshot for all configured endpoints.
   */
  public getEndpointsHealth(): RpcEndpointHealth[] {
    return this.endpoints.map((url) => ({ ...this.health.get(url)! }));
  }

  /**
   * Rotates active endpoint to next available in the configured list.
   */
  public failoverToNext(): string {
    const previous = this.getActiveRpcUrl();
    this.activeIndex = (this.activeIndex + 1) % this.endpoints.length;
    const current = this.getActiveRpcUrl();
    console.warn(`[RpcClient] Failover triggered: ${previous} -> ${current}`);
    return current;
  }

  /**
   * Resets health status of an endpoint or all endpoints.
   */
  public resetHealth(url?: string): void {
    if (url) {
      const h = this.health.get(url);
      if (h) {
        h.isHealthy = true;
        h.consecutiveFailures = 0;
      }
    } else {
      for (const h of this.health.values()) {
        h.isHealthy = true;
        h.consecutiveFailures = 0;
      }
    }
  }

  /**
   * Fetches contract events with automatic multi-RPC failover.
   * If the active RPC endpoint fails, it rotates to secondary endpoints without altering query params.
   */
  public async getEvents(
    request: rpc.Api.GetEventsRequest
  ): Promise<rpc.Api.GetEventsResponse> {
    let attempts = 0;
    const maxAttempts = this.endpoints.length;
    const errors: string[] = [];

    while (attempts < maxAttempts) {
      const activeUrl = this.getActiveRpcUrl();
      const server = this.servers.get(activeUrl);
      const healthRecord = this.health.get(activeUrl)!;

      healthRecord.totalRequests++;

      try {
        if (!server) {
          throw new Error(`RPC server not initialized for ${activeUrl}`);
        }

        const response = await server.getEvents(request);

        // Success: record healthy state
        healthRecord.isHealthy = true;
        healthRecord.consecutiveFailures = 0;
        healthRecord.lastSuccessTime = Date.now();

        return response;
      } catch (err: unknown) {
        const errorMsg = (err as Error).message || "RPC call failed";
        errors.push(`${activeUrl}: ${errorMsg}`);

        healthRecord.totalFailures++;
        healthRecord.consecutiveFailures++;
        healthRecord.lastFailureTime = Date.now();

        if (healthRecord.consecutiveFailures >= this.failoverThreshold) {
          healthRecord.isHealthy = false;
        }

        // Failover to next endpoint if more endpoints exist
        if (this.endpoints.length > 1) {
          this.failoverToNext();
        }

        attempts++;
      }
    }

    throw new Error(
      `All ${this.endpoints.length} RPC endpoints failed for getEvents. Errors: [${errors.join("; ")}]`
    );
  }
}
