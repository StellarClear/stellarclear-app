import type { IDatabaseClient, InMemoryDatabaseClient } from "../client.js";
import type { DbResolution } from "../types.js";

export class ResolutionRepository {
  constructor(private client: IDatabaseClient) {}

  public async insert(resolution: DbResolution): Promise<DbResolution> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("resolutions");
      const existing = table.find(
        (r) =>
          r["network"] === resolution.network &&
          r["case_id"] === resolution.case_id &&
          r["resolver"] === resolution.resolver
      );
      if (existing) {
        return existing as unknown as DbResolution;
      }
      const record = { ...resolution, id: table.length + 1 };
      table.push(record);
      return record;
    }

    const sql = `
      INSERT INTO resolutions (network, case_id, resolver, resolution_commitment, resolution_type, tx_hash, submitted_at_ledger, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (network, case_id, resolver) DO NOTHING
      RETURNING *;
    `;
    const res = await this.client.query<DbResolution>(sql, [
      resolution.network,
      resolution.case_id,
      resolution.resolver,
      resolution.resolution_commitment,
      resolution.resolution_type ?? null,
      resolution.tx_hash ?? null,
      resolution.submitted_at_ledger ?? null,
    ]);
    return res.rows[0] ?? resolution;
  }

  public async findByCaseId(caseId: string, network: string): Promise<DbResolution[]> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("resolutions");
      return table.filter(
        (r) => r["case_id"] === caseId && r["network"] === network
      ) as unknown as DbResolution[];
    }

    const sql = `SELECT * FROM resolutions WHERE case_id = $1 AND network = $2 ORDER BY id ASC;`;
    const res = await this.client.query<DbResolution>(sql, [caseId, network]);
    return res.rows;
  }
}
