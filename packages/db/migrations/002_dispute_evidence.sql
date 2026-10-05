-- ==========================================================
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
