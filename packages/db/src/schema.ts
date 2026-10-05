/**
 * PostgreSQL Table Names and Schema Constants for Settlement Evidence
 */
export const TABLES = {
  SETTLEMENT_CASES: "settlement_cases",
  SETTLEMENT_OBSERVATIONS: "settlement_observations",
  RECONCILIATION_RESULTS: "reconciliation_results",
  BREAKS: "breaks",
  CONTRACT_EVENTS: "contract_events",
  INDEXED_TRANSACTIONS: "indexed_transactions",
  ATTESTATIONS: "attestations",
  DISPUTES: "disputes",
  RESOLUTIONS: "resolutions",
  INGESTION_CURSORS: "ingestion_cursors",
  DISPUTE_EXPIRATIONS: "dispute_expirations",
} as const;

export interface ChainReferenceFields {
  contract_id?: string | null;
  network: string;
  create_tx_hash?: string | null;
  observation_tx_hash?: string | null;
  reconciliation_tx_hash?: string | null;
  attestation_tx_hash?: string | null;
  dispute_tx_hash?: string | null;
  resolution_tx_hash?: string | null;
  finalization_tx_hash?: string | null;
  submission_status?: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED" | null;
  confirmed_at_ledger?: number | null;
}
