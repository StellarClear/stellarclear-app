import type { IDatabaseClient, InMemoryDatabaseClient } from "../client.js";
import type { DbDisputeExpiration } from "../types.js";

/**
 * Repository for dispute_expirations table.
 *
 * Records are written exclusively when a DisputeExpired event is decoded
 * from the Soroban SettlementRegistry contract. The on-chain event is the
 * only authoritative source of truth — no local timer or wall-clock
 * assumption is permitted to create or modify these records.
 */
export class DisputeExpirationRepository {
  constructor(private client: IDatabaseClient) {}

  /**
   * Idempotently records a dispute expiration event.
   * If a record already exists for (network, case_id) it is returned unchanged
   * so that duplicate event delivery does not overwrite durable evidence.
   */
  public async insert(expiration: DbDisputeExpiration): Promise<DbDisputeExpiration> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("dispute_expirations");
      const existing = table.find(
        (r) => r["network"] === expiration.network && r["case_id"] === expiration.case_id
      );
      if (existing) {
        return existing as unknown as DbDisputeExpiration;
      }
      const record = { ...expiration, id: table.length + 1 };
      table.push(record);
      return record;
    }

    const sql = `
      INSERT INTO dispute_expirations
        (network, case_id, expired_at_ledger, expired_at_timestamp, event_cursor, tx_hash, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (network, case_id) DO NOTHING
      RETURNING *;
    `;
    const res = await this.client.query<DbDisputeExpiration>(sql, [
      expiration.network,
      expiration.case_id,
      expiration.expired_at_ledger,
      expiration.expired_at_timestamp ?? null,
      expiration.event_cursor,
      expiration.tx_hash ?? null,
    ]);
    return res.rows[0] ?? expiration;
  }

  public async findByCaseId(
    caseId: string,
    network: string
  ): Promise<DbDisputeExpiration | null> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("dispute_expirations");
      const row = table.find(
        (r) => r["case_id"] === caseId && r["network"] === network
      );
      return (row as unknown as DbDisputeExpiration) ?? null;
    }

    const sql = `
      SELECT * FROM dispute_expirations WHERE case_id = $1 AND network = $2 LIMIT 1;
    `;
    const res = await this.client.query<DbDisputeExpiration>(sql, [caseId, network]);
    return res.rows[0] ?? null;
  }
}
