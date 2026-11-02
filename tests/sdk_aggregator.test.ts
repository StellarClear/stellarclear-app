import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import {
  ObserverSignatureAggregator,
  type ObserverAttestation,
} from "@stellarclear/sdk";

const CASE_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OBSERVER_1 = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEWBIXXX";
const OBSERVER_2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OBSERVER_3 = "GCXYZ47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL999";
const UNLISTED_OBSERVER = "GDUNLISTED6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL000";

describe("SDK - ObserverSignatureAggregator", () => {
  it("initializes cleanly with valid caseId and options", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);
    assert.strictEqual(aggregator.getCaseId(), CASE_ID);
    assert.strictEqual(aggregator.getCount(), 0);

    assert.throws(
      () => new ObserverSignatureAggregator(""),
      /valid non-empty caseId/
    );
  });

  it("handles happy path: ingests attestations from distinct observers", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);

    const att1: ObserverAttestation = {
      caseId: CASE_ID,
      observer: OBSERVER_1,
      commitment: "aaaa".repeat(16),
      signature: "sig1",
      ledger: 100,
    };
    const att2: ObserverAttestation = {
      caseId: CASE_ID,
      observer: OBSERVER_2,
      commitment: "bbbb".repeat(16),
      signature: "sig2",
      ledger: 101,
    };

    assert.strictEqual(aggregator.addAttestation(att1), true);
    assert.strictEqual(aggregator.addAttestation(att2), true);
    assert.strictEqual(aggregator.getCount(), 2);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_1), true);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_2), true);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_3), false);
  });

  it("rejects duplicate attestations from the same observer public key", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);

    const att1: ObserverAttestation = {
      caseId: CASE_ID,
      observer: OBSERVER_1,
      commitment: "aaaa".repeat(16),
    };
    const duplicateAtt1: ObserverAttestation = {
      caseId: CASE_ID,
      observer: OBSERVER_1,
      commitment: "cccc".repeat(16),
    };

    assert.strictEqual(aggregator.addAttestation(att1), true);
    assert.strictEqual(aggregator.addAttestation(duplicateAtt1), false);
    assert.strictEqual(aggregator.getCount(), 1);
  });

  it("rejects attestations with mismatched caseId or invalid fields", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);

    assert.strictEqual(
      aggregator.addAttestation({
        caseId: "different-case-id",
        observer: OBSERVER_1,
        commitment: "aaaa",
      }),
      false
    );

    assert.strictEqual(
      aggregator.addAttestation({
        caseId: CASE_ID,
        observer: "",
        commitment: "aaaa",
      }),
      false
    );

    assert.strictEqual(
      aggregator.addAttestation({
        caseId: CASE_ID,
        observer: OBSERVER_1,
        commitment: "",
      }),
      false
    );
  });

  it("enforces constructor whitelist and filters unlisted observers", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID, {
      whitelist: [OBSERVER_1, OBSERVER_2],
    });

    assert.strictEqual(
      aggregator.addAttestation({
        caseId: CASE_ID,
        observer: OBSERVER_1,
        commitment: "aaaa".repeat(16),
      }),
      true
    );

    assert.strictEqual(
      aggregator.addAttestation({
        caseId: CASE_ID,
        observer: UNLISTED_OBSERVER,
        commitment: "dddd".repeat(16),
      }),
      false
    );

    assert.strictEqual(aggregator.getCount(), 1);
  });

  it("validates quorum satisfaction against thresholds and whitelists", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);

    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_1,
      commitment: "aaaa".repeat(16),
    });
    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_2,
      commitment: "bbbb".repeat(16),
    });

    // 2 attestations present
    assert.strictEqual(aggregator.validateQuorum(1), true);
    assert.strictEqual(aggregator.validateQuorum(2), true);
    assert.strictEqual(aggregator.validateQuorum(3), false); // insufficient quorum
    assert.strictEqual(aggregator.validateQuorum(0), false); // invalid threshold

    // Quorum with active whitelist override
    assert.strictEqual(
      aggregator.validateQuorum(2, [OBSERVER_1, OBSERVER_2, OBSERVER_3]),
      true
    );
    assert.strictEqual(
      aggregator.validateQuorum(2, [OBSERVER_1, OBSERVER_3]), // only 1 in whitelist
      false
    );
  });

  it("guarantees deterministic lexicographical ordering by observer address", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);

    // Insert out of order: OBSERVER_3 ("GC..."), OBSERVER_1 ("GA..."), OBSERVER_2 ("GB...")
    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_3,
      commitment: "cccc".repeat(16),
    });
    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_1,
      commitment: "aaaa".repeat(16),
    });
    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_2,
      commitment: "bbbb".repeat(16),
    });

    const sorted = aggregator.getAttestations();
    assert.strictEqual(sorted.length, 3);
    assert.strictEqual(sorted[0].observer, OBSERVER_1);
    assert.strictEqual(sorted[1].observer, OBSERVER_2);
    assert.strictEqual(sorted[2].observer, OBSERVER_3);

    const observers = aggregator.getObservers();
    assert.deepStrictEqual(observers, [OBSERVER_1, OBSERVER_2, OBSERVER_3]);
  });

  it("produces complete finalization payload with Buffer case_id", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);

    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_2,
      commitment: "bbbb".repeat(16),
    });
    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_1,
      commitment: "aaaa".repeat(16),
    });

    const payload = aggregator.toFinalizationPayload();
    assert.strictEqual(payload.caseId, CASE_ID);
    assert.ok(Buffer.isBuffer(payload.case_id));
    assert.strictEqual(payload.case_id.toString("hex"), CASE_ID);
    assert.strictEqual(payload.count, 2);
    assert.strictEqual(payload.observers[0], OBSERVER_1);
    assert.strictEqual(payload.observers[1], OBSERVER_2);
    assert.strictEqual(payload.attestations[0].observer, OBSERVER_1);
  });

  it("clears all ingested attestations cleanly", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID);
    aggregator.addAttestation({
      caseId: CASE_ID,
      observer: OBSERVER_1,
      commitment: "aaaa".repeat(16),
    });
    assert.strictEqual(aggregator.getCount(), 1);

    aggregator.clear();
    assert.strictEqual(aggregator.getCount(), 0);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_1), false);
  });
});
