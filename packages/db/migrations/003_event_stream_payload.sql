-- ==========================================================
-- StellarClear Migration 003
-- Purpose: Persist the decoded event payload for every processed contract
--          event so the realtime stream can replay durable history from the
--          database using the deterministic event cursor.
-- ==========================================================
ALTER TABLE contract_events
  ADD COLUMN IF NOT EXISTS payload JSONB;
