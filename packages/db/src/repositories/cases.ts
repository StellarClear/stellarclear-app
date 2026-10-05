import type { IDatabaseClient, InMemoryDatabaseClient } from "../client.js";
import type { DbSettlementCase } from "../types.js";
import type { CaseStatus } from "@stellarclear/schemas";

export class CaseRepository {
  constructor(private client: IDatabaseClient) {}

  public async insert(caseData: DbSettlementCase): Promise<DbSettlementCase> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("settlement_cases");
      const existing = table.find((r) => r["id"] === caseData.id.toLowerCase() && r["network"] === caseData.network);
      if (existing) {
        throw new Error(`Duplicate case ${caseData.id} on network ${caseData.network}`);
      }
      const record = { ...caseData, id: caseData.id.toLowerCase() };
      table.push(record);
      return record;
    }

    const sql = `
      INSERT INTO settlement_cases (
        id, network, contract_id, owner, counterparty, trade_reference, asset, amount,
        expected_destination, reference, terms_commitment, expires_at_ledger,
        status, create_tx_hash, observation_tx_hash, reconciliation_tx_hash,
        attestation_tx_hash, dispute_tx_hash, resolution_tx_hash, finalization_tx_hash,
        submission_status, confirmed_at_ledger, created_at_ledger, finalized_at_ledger,
        observer_quorum, dispute_expires_at_ledger, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, NOW(), NOW())
      RETURNING *;
    `;
    const params = [
      caseData.id,
      caseData.network,
      caseData.contract_id ?? null,
      caseData.owner,
      caseData.counterparty ?? null,
      caseData.trade_reference,
      caseData.asset,
      caseData.amount,
      caseData.expected_destination,
      caseData.reference ?? null,
      caseData.terms_commitment,
      caseData.expires_at_ledger,
      caseData.status,
      caseData.create_tx_hash ?? null,
      caseData.observation_tx_hash ?? null,
      caseData.reconciliation_tx_hash ?? null,
      caseData.attestation_tx_hash ?? null,
      caseData.dispute_tx_hash ?? null,
      caseData.resolution_tx_hash ?? null,
      caseData.finalization_tx_hash ?? null,
      caseData.submission_status ?? null,
      caseData.confirmed_at_ledger ?? null,
      caseData.created_at_ledger ?? null,
      caseData.finalized_at_ledger ?? null,
      caseData.observer_quorum ?? 1,
      caseData.dispute_expires_at_ledger ?? null,
    ];
    const res = await this.client.query<DbSettlementCase>(sql, params);
    return res.rows[0];
  }

  public async updateChainReferences(
    id: string,
    network: string,
    refs: Partial<DbSettlementCase>
  ): Promise<void> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("settlement_cases");
      const row = table.find((r) => r["id"] === id.toLowerCase() && r["network"] === network);
      if (row) {
        Object.assign(row, refs, { updated_at: new Date() });
      }
      return;
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const [key, val] of Object.entries(refs)) {
      if (key !== "id" && key !== "network") {
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) return;

    setClauses.push(`updated_at = NOW()`);
    values.push(id.toLowerCase(), network);

    const sql = `
      UPDATE settlement_cases
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIdx} AND network = $${paramIdx + 1};
    `;
    await this.client.query(sql, values);
  }

  public async findById(id: string, network: string): Promise<DbSettlementCase | null> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("settlement_cases");
      const row = table.find((r) => r["id"] === id.toLowerCase() && r["network"] === network);
      return (row as unknown as DbSettlementCase) ?? null;
    }

    const sql = `SELECT * FROM settlement_cases WHERE id = $1 AND network = $2 LIMIT 1;`;
    const res = await this.client.query<DbSettlementCase>(sql, [id.toLowerCase(), network]);
    return res.rows[0] ?? null;
  }

  public async updateStatus(
    id: string,
    network: string,
    status: CaseStatus,
    finalizedLedger?: number
  ): Promise<void> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("settlement_cases");
      const row = table.find((r) => r["id"] === id.toLowerCase() && r["network"] === network);
      if (row) {
        row["status"] = status;
        row["updated_at"] = new Date();
        if (finalizedLedger !== undefined) {
          row["finalized_at_ledger"] = finalizedLedger;
        }
      }
      return;
    }

    const sql = `
      UPDATE settlement_cases
      SET status = $1, finalized_at_ledger = COALESCE($2, finalized_at_ledger), updated_at = NOW()
      WHERE id = $3 AND network = $4;
    `;
    await this.client.query(sql, [status, finalizedLedger ?? null, id.toLowerCase(), network]);
  }

  public async updateQuorum(id: string, network: string, quorum: number): Promise<void> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("settlement_cases");
      const row = table.find((r) => r["id"] === id.toLowerCase() && r["network"] === network);
      if (row) {
        row["observer_quorum"] = quorum;
        row["updated_at"] = new Date();
      }
      return;
    }

    const sql = `
      UPDATE settlement_cases
      SET observer_quorum = $1, updated_at = NOW()
      WHERE id = $2 AND network = $3;
    `;
    await this.client.query(sql, [quorum, id.toLowerCase(), network]);
  }

  public async updateDisputeExpiration(
    id: string,
    network: string,
    expirationLedger: number | null
  ): Promise<void> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("settlement_cases");
      const row = table.find((r) => r["id"] === id.toLowerCase() && r["network"] === network);
      if (row) {
        row["dispute_expires_at_ledger"] = expirationLedger;
        row["updated_at"] = new Date();
      }
      return;
    }

    const sql = `
      UPDATE settlement_cases
      SET dispute_expires_at_ledger = $1, updated_at = NOW()
      WHERE id = $2 AND network = $3;
    `;
    await this.client.query(sql, [expirationLedger, id.toLowerCase(), network]);
  }

  public async list(network: string, limit = 50, offset = 0): Promise<DbSettlementCase[]> {
    if ("getTable" in this.client) {
      const mem = this.client as unknown as InMemoryDatabaseClient;
      const table = mem.getTable("settlement_cases");
      return table
        .filter((r) => r["network"] === network)
        .slice(offset, offset + limit) as unknown as DbSettlementCase[];
    }

    const sql = `
      SELECT * FROM settlement_cases
      WHERE network = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const res = await this.client.query<DbSettlementCase>(sql, [network, limit, offset]);
    return res.rows;
  }
}
