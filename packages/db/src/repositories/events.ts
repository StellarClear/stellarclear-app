import type { IDatabaseClient, InMemoryDatabaseClient } from "../client.js";
import type { DbContractEvent } from "../types.js";

export class ContractEventRepository {
  constructor(private client: IDatabaseClient) {}

  public async insert(event: DbContractEvent): Promise<DbContractEvent> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("contract_events");
      const existing = table.find((r) => r["cursor"] === event.cursor && r["network"] === event.network);
      if (existing) {
        return existing as unknown as DbContractEvent;
      }
      const record = { ...event, id: table.length + 1 };
      table.push(record);
      return record;
    }

    const sql = `
      INSERT INTO contract_events (
        network, contract_id, ledger, tx_hash, event_type,
        case_id, topic_xdr, data_xdr, cursor, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (network, cursor) DO UPDATE SET cursor = EXCLUDED.cursor
      RETURNING *;
    `;
    const params = [
      event.network,
      event.contract_id,
      event.ledger,
      event.tx_hash,
      event.event_type,
      event.case_id ?? null,
      event.topic_xdr,
      event.data_xdr,
      event.cursor,
      event.payload ? JSON.stringify(event.payload) : null,
    ];
    const res = await this.client.query<DbContractEvent>(sql, params);
    return res.rows[0];
  }

  public async listByCaseId(caseId: string, network: string): Promise<DbContractEvent[]> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("contract_events");
      return table
        .filter((r) => r["case_id"] === caseId && r["network"] === network)
        .sort((a, b) => (Number(a["ledger"]) || 0) - (Number(b["ledger"]) || 0)) as unknown as DbContractEvent[];
    }

    const sql = `SELECT * FROM contract_events WHERE case_id = $1 AND network = $2 ORDER BY ledger ASC;`;
    const res = await this.client.query<DbContractEvent>(sql, [caseId, network]);
    return res.rows;
  }

  /** Looks up a persisted event by its deterministic cursor. */
  public async findByCursor(cursor: string, network: string): Promise<DbContractEvent | null> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const row = mem
        .getTable("contract_events")
        .find((r) => r["cursor"] === cursor && r["network"] === network);
      return (row as unknown as DbContractEvent) ?? null;
    }
    const res = await this.client.query<DbContractEvent>(
      `SELECT * FROM contract_events WHERE cursor = $1 AND network = $2 LIMIT 1;`,
      [cursor, network]
    );
    return res.rows[0] ?? null;
  }

  /** Lists persisted events with id strictly greater than afterId, in ingestion order. */
  public async listAfterId(
    network: string,
    afterId: number,
    limit: number
  ): Promise<DbContractEvent[]> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      return mem
        .getTable("contract_events")
        .filter((r) => r["network"] === network && Number(r["id"]) > afterId)
        .sort((a, b) => Number(a["id"]) - Number(b["id"]))
        .slice(0, limit) as unknown as DbContractEvent[];
    }
    const res = await this.client.query<DbContractEvent>(
      `SELECT * FROM contract_events WHERE network = $1 AND id > $2 ORDER BY id ASC LIMIT $3;`,
      [network, afterId, limit]
    );
    return res.rows;
  }

  /** Highest persisted event id for the network (0 if none). */
  public async maxId(network: string): Promise<number> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      return mem
        .getTable("contract_events")
        .filter((r) => r["network"] === network)
        .reduce((m, r) => Math.max(m, Number(r["id"]) || 0), 0);
    }
    const res = await this.client.query<{ max: string | number | null }>(
      `SELECT MAX(id) AS max FROM contract_events WHERE network = $1;`,
      [network]
    );
    return Number(res.rows[0]?.max ?? 0);
  }
}
