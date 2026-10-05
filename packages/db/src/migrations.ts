import type { IDatabaseClient } from "./client.js";

export const INITIAL_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS settlement_cases (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    contract_id VARCHAR(64),
    owner VARCHAR(56) NOT NULL,
    counterparty VARCHAR(56),
    trade_reference VARCHAR(128) NOT NULL,
    asset VARCHAR(128) NOT NULL,
    amount VARCHAR(64) NOT NULL,
    expected_destination VARCHAR(56) NOT NULL,
    reference VARCHAR(128),
    terms_commitment VARCHAR(64) NOT NULL,
    expires_at_ledger BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    create_tx_hash VARCHAR(128),
    observation_tx_hash VARCHAR(128),
    reconciliation_tx_hash VARCHAR(128),
    attestation_tx_hash VARCHAR(128),
    dispute_tx_hash VARCHAR(128),
    resolution_tx_hash VARCHAR(128),
    finalization_tx_hash VARCHAR(128),
    submission_status VARCHAR(32),
    confirmed_at_ledger BIGINT,
    created_at_ledger BIGINT,
    finalized_at_ledger BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_settlement_cases_network_id UNIQUE (network, id)
);

CREATE TABLE IF NOT EXISTS settlement_observations (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    case_id VARCHAR(64) NOT NULL REFERENCES settlement_cases(id) ON DELETE CASCADE,
    observer VARCHAR(56) NOT NULL,
    tx_hash VARCHAR(64) NOT NULL,
    observed_ledger BIGINT NOT NULL,
    observation_commitment VARCHAR(64) NOT NULL,
    observation_tx_hash VARCHAR(128),
    confirmed_at_ledger BIGINT,
    asset VARCHAR(128) NOT NULL,
    amount VARCHAR(64) NOT NULL,
    destination VARCHAR(56) NOT NULL,
    reference VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_settlement_observations_network_case_tx UNIQUE (network, case_id, tx_hash)
);

CREATE TABLE IF NOT EXISTS reconciliation_results (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    case_id VARCHAR(64) NOT NULL REFERENCES settlement_cases(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL,
    matched BOOLEAN NOT NULL,
    reconciliation_tx_hash VARCHAR(128),
    confirmed_at_ledger BIGINT,
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_reconciliation_results_network_case UNIQUE (network, case_id)
);

CREATE TABLE IF NOT EXISTS breaks (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    case_id VARCHAR(64) NOT NULL REFERENCES settlement_cases(id) ON DELETE CASCADE,
    reconciliation_id BIGINT REFERENCES reconciliation_results(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    field VARCHAR(64) NOT NULL,
    expected_value TEXT,
    observed_value TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_events (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    contract_id VARCHAR(56) NOT NULL,
    ledger BIGINT NOT NULL,
    tx_hash VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    case_id VARCHAR(64),
    topic_xdr TEXT NOT NULL,
    data_xdr TEXT NOT NULL,
    cursor VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contract_events_network_cursor UNIQUE (network, cursor)
);

CREATE TABLE IF NOT EXISTS indexed_transactions (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    tx_hash VARCHAR(64) NOT NULL,
    ledger BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_indexed_transactions_network_hash UNIQUE (network, tx_hash)
);

CREATE TABLE IF NOT EXISTS attestations (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    case_id VARCHAR(64) NOT NULL REFERENCES settlement_cases(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    attestor VARCHAR(56) NOT NULL,
    commitment VARCHAR(64) NOT NULL,
    attested_at_ledger BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attestations_network_case_attestor UNIQUE (network, case_id, attestor)
);

CREATE TABLE IF NOT EXISTS disputes (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    case_id VARCHAR(64) NOT NULL REFERENCES settlement_cases(id) ON DELETE CASCADE,
    initiator VARCHAR(56) NOT NULL,
    dispute_commitment VARCHAR(64) NOT NULL,
    opened_at_ledger BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_disputes_network_case_initiator UNIQUE (network, case_id, initiator)
);

CREATE TABLE IF NOT EXISTS resolutions (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    case_id VARCHAR(64) NOT NULL REFERENCES settlement_cases(id) ON DELETE CASCADE,
    resolver VARCHAR(56) NOT NULL,
    resolution_commitment VARCHAR(64) NOT NULL,
    submitted_at_ledger BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_resolutions_network_case_resolver UNIQUE (network, case_id, resolver)
);

CREATE TABLE IF NOT EXISTS ingestion_cursors (
    id BIGSERIAL PRIMARY KEY,
    network VARCHAR(32) NOT NULL UNIQUE,
    last_processed_ledger BIGINT NOT NULL DEFAULT 0,
    last_processed_event_cursor VARCHAR(128),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/**
 * Incremental, idempotent migrations applied after the initial schema.
 * These mirror packages/db/migrations/002_*.sql and 003_*.sql.
 */
export const ADDITIONAL_MIGRATIONS: readonly string[] = [
`-- ==========================================================
-- StellarClear Migration 002
-- Purpose: Add durable evidence fields to disputes and resolutions
--          so dispute details survive API process restarts.
--          Add dispute_expiry support for DisputeExpired indexer events.
-- ==========================================================

-- Add durable evidence fields to disputes
-- reason: the human-readable dispute reason submitted by the initiator
-- tx_hash: the on-chain transaction hash anchoring the dispute
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(64);

-- Add durable evidence fields to resolutions
-- resolution_type: classification of the resolution (e.g. MUTUAL_AGREEMENT)
-- tx_hash: the on-chain transaction hash anchoring the resolution submission
ALTER TABLE resolutions
  ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(64),
  ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(64);

-- Add dispute_expiry tracking for the DisputeExpired indexer event (TASK E)
-- This table records when a dispute expired on-chain, including the authoritative
-- ledger sequence from the Soroban event. The on-chain event is the only
-- authoritative source — this record must never be fabricated from a local timer.
CREATE TABLE IF NOT EXISTS dispute_expirations (
  id BIGSERIAL PRIMARY KEY,
  network VARCHAR(32) NOT NULL,
  case_id VARCHAR(64) NOT NULL REFERENCES settlement_cases(id) ON DELETE CASCADE,
  expired_at_ledger BIGINT NOT NULL,
  expired_at_timestamp TIMESTAMPTZ,
  event_cursor VARCHAR(128) NOT NULL,
  tx_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_dispute_expirations_network_case UNIQUE (network, case_id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_expirations_case_id ON dispute_expirations(case_id);

-- Add observer_quorum and dispute_expires_at_ledger to settlement_cases
ALTER TABLE settlement_cases
  ADD COLUMN IF NOT EXISTS observer_quorum INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dispute_expires_at_ledger BIGINT;
`,
`-- ==========================================================
-- StellarClear Migration 003
-- Purpose: Persist the decoded event payload for every processed contract
--          event so the realtime stream can replay durable history from the
--          database using the deterministic event cursor.
-- ==========================================================
ALTER TABLE contract_events
  ADD COLUMN IF NOT EXISTS payload JSONB;
`,
];

/**
 * Executes the database migration scripts against the configured client.
 */
export async function runMigrations(client: IDatabaseClient): Promise<void> {
  await client.query(INITIAL_MIGRATION_SQL);
  for (const sql of ADDITIONAL_MIGRATIONS) {
    await client.query(sql);
  }
}
