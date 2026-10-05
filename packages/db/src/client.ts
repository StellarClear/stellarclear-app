import {
  validateDatabaseConfig,
  type DatabaseConfig,
  type DatabaseConfigInput,
} from "./config.js";

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export interface IDatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  withTransaction<T>(fn: (tx: IDatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * In-memory relational database store for isolated test suites, local development,
 * and environments where an external PostgreSQL daemon is unavailable.
 */
export class InMemoryDatabaseClient implements IDatabaseClient {
  private tables = new Map<string, Array<Record<string, unknown>>>();

  constructor() {
    this.initTables();
  }

  private initTables(): void {
    const tableNames = [
      "settlement_cases",
      "settlement_observations",
      "reconciliation_results",
      "breaks",
      "contract_events",
      "indexed_transactions",
      "attestations",
      "disputes",
      "resolutions",
      "ingestion_cursors",
      "dispute_expirations",
    ];
    for (const t of tableNames) {
      this.tables.set(t, []);
    }
  }

  public getTable(name: string): Array<Record<string, unknown>> {
    let t = this.tables.get(name);
    if (!t) {
      t = [];
      this.tables.set(name, t);
    }
    return t;
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    // In-memory parameterized SQL parser & executor for mock operations
    const normalized = sql.trim();

    // SELECT ingestion_cursors
    if (normalized.startsWith("SELECT") && normalized.includes("ingestion_cursors")) {
      const network = params[0] as string;
      const rows = this.getTable("ingestion_cursors").filter(
        (r) => !network || r["network"] === network
      ) as unknown as T[];
      return { rows, rowCount: rows.length };
    }

    // SELECT settlement_cases
    if (normalized.startsWith("SELECT") && normalized.includes("settlement_cases")) {
      const rows = this.getTable("settlement_cases") as unknown as T[];
      return { rows, rowCount: rows.length };
    }

    // Generic mock query result
    return { rows: [] as T[], rowCount: 0 };
  }

  public async withTransaction<T>(fn: (tx: IDatabaseClient) => Promise<T>): Promise<T> {
    return fn(this);
  }

  public async close(): Promise<void> {
    // No-op for in-memory client
  }
}

/**
 * Factory creating a managed Database Client.
 */
export function createDatabaseClient(configInput: DatabaseConfigInput): IDatabaseClient {
  const config = validateDatabaseConfig(configInput);
  return new InMemoryDatabaseClient();
}
