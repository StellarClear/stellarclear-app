import type { SettlementDiagnosticsService, SettlementDiagnosticsResponse } from "./operations.js";

/**
 * Service that formats system and settlement operational diagnostics
 * into standard Prometheus text exposition format (text/plain; version=0.0.4).
 */
export class PrometheusMetricsExporter {
  constructor(private readonly diagnosticsService: SettlementDiagnosticsService) {}

  public async getMetrics(): Promise<string> {
    const diag: SettlementDiagnosticsResponse = await this.diagnosticsService.getDiagnostics();
    const lines: string[] = [];

    // Helper to format a metric
    const addMetric = (
      name: string,
      help: string,
      type: "counter" | "gauge",
      samples: Array<{ labels?: Record<string, string>; value: number }>
    ) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const sample of samples) {
        if (sample.labels && Object.keys(sample.labels).length > 0) {
          const labelStr = Object.entries(sample.labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(",");
          lines.push(`${name}{${labelStr}} ${sample.value}`);
        } else {
          lines.push(`${name} ${sample.value}`);
        }
      }
    };

    // 1. Cases by status
    addMetric(
      "stellarclear_cases_total",
      "Total number of settlement cases by status",
      "counter",
      [
        { labels: { status: "OPEN" }, value: diag.pipeline.openCases },
        { labels: { status: "MATCHED" }, value: diag.pipeline.matchedCases },
        { labels: { status: "BREAK" }, value: diag.pipeline.brokenCases },
        { labels: { status: "DISPUTED" }, value: diag.pipeline.disputedCases },
        { labels: { status: "RESOLVED" }, value: diag.pipeline.resolvedCases },
        { labels: { status: "FINALIZED" }, value: diag.pipeline.finalizedCases },
      ]
    );

    // 2. Matched settlements counter
    addMetric(
      "stellarclear_settlements_matched_total",
      "Total number of successfully matched settlements",
      "counter",
      [{ value: diag.pipeline.matchedCases + diag.pipeline.finalizedCases }]
    );

    // 3. Classified breaks counter
    addMetric(
      "stellarclear_breaks_classified_total",
      "Total number of classified settlement breaks",
      "counter",
      [{ value: diag.pipeline.brokenCases + diag.pipeline.disputedCases }]
    );

    // 4. Active disputes gauge
    addMetric(
      "stellarclear_disputes_active_total",
      "Total number of currently active settlement disputes",
      "gauge",
      [{ value: diag.pipeline.disputedCases }]
    );

    // 5. Database pool status gauge (1 = healthy, 0 = unhealthy/degraded)
    const dbPoolStatus = diag.database.status === "healthy" ? 1 : 0;
    addMetric(
      "stellarclear_database_connection_pool_status",
      "Status of the database connection pool (1 = healthy, 0 = degraded or unreachable)",
      "gauge",
      [{ value: dbPoolStatus }]
    );

    // 6. Ledger sync cursor lag gauge
    const latestLedger = diag.indexing.latestLedger ?? 0;
    const checkpoint = diag.indexing.indexedCheckpoint ?? 0;
    const cursorLag = Math.max(0, latestLedger - checkpoint);
    addMetric(
      "stellarclear_ledger_sync_cursor_lag",
      "Ledger sequence lag between latest ledger and indexed checkpoint",
      "gauge",
      [{ value: cursorLag }]
    );

    // 7. API Uptime seconds
    addMetric(
      "stellarclear_api_uptime_seconds",
      "Total operational uptime of the API server in seconds",
      "gauge",
      [{ value: diag.uptimeSeconds }]
    );

    // 8. Database latency ms
    addMetric(
      "stellarclear_database_latency_milliseconds",
      "Latency of database health check queries in milliseconds",
      "gauge",
      [{ value: diag.database.latencyMs }]
    );

    return lines.join("\n") + "\n";
  }
}

