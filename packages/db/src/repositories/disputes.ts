import type { IDatabaseClient, InMemoryDatabaseClient } from "../client.js";
import type { DbDispute } from "../types.js";

export class DisputeRepository {
  constructor(private client: IDatabaseClient) {}

  public async insert(dispute: DbDispute): Promise<DbDispute> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("disputes");
      const existing = table.find(
        (r) =>
          r["network"] === dispute.network &&
          r["case_id"] === dispute.case_id &&
          r["initiator"] === dispute.initiator
      );
      if (existing) {
        return existing as unknown as DbDispute;
      }
      const record = { ...dispute, id: table.length + 1 };
      table.push(record);
      return record;
    }

    const sql = `
      INSERT INTO disputes (network, case_id, initiator, dispute_commitment, reason, tx_hash, opened_at_ledger, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (network, case_id, initiator) DO NOTHING
      RETURNING *;
    `;
    const res = await this.client.query<DbDispute>(sql, [
      dispute.network,
      dispute.case_id,
      dispute.initiator,
      dispute.dispute_commitment,
      dispute.reason ?? null,
      dispute.tx_hash ?? null,
      dispute.opened_at_ledger ?? null,
    ]);
    return res.rows[0] ?? dispute;
  }

  public async findByCaseId(caseId: string, network: string): Promise<DbDispute[]> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("disputes");
      return table.filter(
        (r) => r["case_id"] === caseId && r["network"] === network
      ) as unknown as DbDispute[];
    }

    const sql = `SELECT * FROM disputes WHERE case_id = $1 AND network = $2 ORDER BY id ASC;`;
    const res = await this.client.query<DbDispute>(sql, [caseId, network]);
    return res.rows;
  }
}
