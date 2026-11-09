import { Buffer } from "buffer";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ObserverSignatureAggregator,
  type ObserverAttestation,
} from "@stellarclear/sdk";

const CASE_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CASE_B = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

const OBSERVER_1 = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEWBIXXX";
const OBSERVER_2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OBSERVER_3 = "GCXKG6RN4ONIEPCMNFB732A436Z5PNDSRLGWK7GBLCMQLIFO4HXQNX2Z";
const OBSERVER_4 = "GD6WJRZBPODDYFIEGN2J2A5W4MVRSR77Q6DKV5MVT3V5M6V5M6V5M6XX";

const COMMITMENT_1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMITMENT_2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const COMMITMENT_3 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const SIG_1 = "1111111111111111111111111111111111111111111111111111111111111111";
const SIG_2 = "2222222222222222222222222222222222222222222222222222222222222222";
const SIG_3 = "3333333333333333333333333333333333333333333333333333333333333333";

describe("SDK Package - Observer Signature Aggregator (Issue #39)", () => {
  it("happy path: aggregates distinct attestations and constructs deterministic finalization payload", () => {
    const aggregator = new ObserverSignatureAggregator({ caseId: CASE_A });

    const att1: ObserverAttestation = {
      caseId: CASE_A,
      observer: OBSERVER_2,
      commitment: COMMITMENT_2,
      signature: SIG_2,
    };
    const att2: ObserverAttestation = {
      caseId: CASE_A,
      observer: OBSERVER_1,
      commitment: COMMITMENT_1,
      signature: SIG_1,
    };
    const att3: ObserverAttestation = {
      caseId: CASE_A,
      observer: OBSERVER_3,
      commitment: Buffer.from(COMMITMENT_3, "hex"),
      signature: Buffer.from(SIG_3, "hex"),
    };

    assert.strictEqual(aggregator.addAttestation(att1), true);
    assert.strictEqual(aggregator.addAttestation(att2), true);
    assert.strictEqual(aggregator.addAttestation(att3), true);

    assert.strictEqual(aggregator.getCount(), 3);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_1), true);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_2), true);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_3), true);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_4), false);

    const payload = aggregator.toFinalizationPayload();
    assert.strictEqual(payload.caseId, CASE_A);
    assert.strictEqual(payload.caseIdBuffer.length, 32);
    assert.strictEqual(payload.caseIdBuffer.toString("hex"), CASE_A);

    // Guaranteed deterministic lexicographical sorting by observer public key
    const expectedSortedObservers = [OBSERVER_1, OBSERVER_2, OBSERVER_3].sort();
    assert.deepStrictEqual(payload.observers, expectedSortedObservers);
    assert.strictEqual(payload.attestations.length, 3);
    assert.strictEqual(payload.commitments.length, 3);
    assert.strictEqual(payload.signatures.length, 3);

    // Verifies ordering matches
    for (let i = 0; i < payload.observers.length; i++) {
      assert.strictEqual(payload.attestations[i].observer, payload.observers[i]);
    }
  });

  it("duplicates rejection: rejects duplicate submissions from identical observer public keys", () => {
    const aggregator = new ObserverSignatureAggregator({ caseId: CASE_A });

    const attestation: ObserverAttestation = {
      caseId: CASE_A,
      observer: OBSERVER_1,
      commitment: COMMITMENT_1,
      signature: SIG_1,
    };

    assert.strictEqual(aggregator.addAttestation(attestation), true);
    // Duplicate submission from identical observer key must be rejected
    assert.strictEqual(aggregator.addAttestation(attestation), false);

    // Another attestation from same observer with different commitment/signature
    const attestationSameObserverDifferentSig: ObserverAttestation = {
      caseId: CASE_A,
      observer: OBSERVER_1,
      commitment: COMMITMENT_2,
      signature: SIG_2,
    };
    assert.strictEqual(aggregator.addAttestation(attestationSameObserverDifferentSig), false);

    // Count must remain 1
    assert.strictEqual(aggregator.getCount(), 1);
  });

  it("duplicates rejection: rejects duplicate signatures across different observer records", () => {
    const aggregator = new ObserverSignatureAggregator({ caseId: CASE_A });

    const att1: ObserverAttestation = {
      caseId: CASE_A,
      observer: OBSERVER_1,
      commitment: COMMITMENT_1,
      signature: SIG_1,
    };
    const att2WithSameSig: ObserverAttestation = {
      caseId: CASE_A,
      observer: OBSERVER_2,
      commitment: COMMITMENT_2,
      signature: SIG_1, // Reused signature
    };

    assert.strictEqual(aggregator.addAttestation(att1), true);
    assert.strictEqual(aggregator.addAttestation(att2WithSameSig), false);
    assert.strictEqual(aggregator.getCount(), 1);
  });

  it("quorum validation: correctly validates quorum against active whitelist", () => {
    const aggregator = new ObserverSignatureAggregator({ caseId: CASE_A });

    aggregator.addAttestation({
      caseId: CASE_A,
      observer: OBSERVER_1,
      commitment: COMMITMENT_1,
      signature: SIG_1,
    });
    aggregator.addAttestation({
      caseId: CASE_A,
      observer: OBSERVER_2,
      commitment: COMMITMENT_2,
      signature: SIG_2,
    });
    aggregator.addAttestation({
      caseId: CASE_A,
      observer: OBSERVER_3,
      commitment: COMMITMENT_3,
      signature: SIG_3,
    });

    // Whitelist includes all three
    assert.strictEqual(aggregator.validateQuorum(3, [OBSERVER_1, OBSERVER_2, OBSERVER_3]), true);
    assert.strictEqual(aggregator.validateQuorum(2, [OBSERVER_1, OBSERVER_2, OBSERVER_3]), true);

    // Whitelist only includes OBSERVER_1 and OBSERVER_2 (OBSERVER_3 was revoked or not in active whitelist)
    assert.strictEqual(aggregator.validateQuorum(2, [OBSERVER_1, OBSERVER_2]), true);
    assert.strictEqual(aggregator.validateQuorum(3, [OBSERVER_1, OBSERVER_2]), false); // Insufficient quorum

    // Whitelist only includes OBSERVER_1
    assert.strictEqual(aggregator.validateQuorum(2, [OBSERVER_1]), false); // Insufficient quorum
    assert.strictEqual(aggregator.validateQuorum(1, [OBSERVER_1]), true);

    // Invalid parameters
    assert.strictEqual(aggregator.validateQuorum(0, [OBSERVER_1, OBSERVER_2]), false);
    assert.strictEqual(aggregator.validateQuorum(-1, [OBSERVER_1, OBSERVER_2]), false);
    assert.strictEqual(aggregator.validateQuorum(1, []), false);
  });

  it("whitelist enforcement: ignores unwhitelisted observers when aggregator has static whitelist", () => {
    const aggregator = new ObserverSignatureAggregator({
      caseId: CASE_A,
      whitelist: [OBSERVER_1, OBSERVER_2],
    });

    // Whitelisted observer
    assert.strictEqual(
      aggregator.addAttestation({
        caseId: CASE_A,
        observer: OBSERVER_1,
        commitment: COMMITMENT_1,
      }),
      true
    );

    // Unwhitelisted observer must be ignored/rejected
    assert.strictEqual(
      aggregator.addAttestation({
        caseId: CASE_A,
        observer: OBSERVER_4,
        commitment: COMMITMENT_1,
      }),
      false
    );

    assert.strictEqual(aggregator.getCount(), 1);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_4), false);
  });

  it("case isolation: rejects attestations with mismatched case ID", () => {
    const aggregator = new ObserverSignatureAggregator({ caseId: CASE_A });

    const mismatchedAttestation: ObserverAttestation = {
      caseId: CASE_B,
      observer: OBSERVER_1,
      commitment: COMMITMENT_1,
    };

    assert.strictEqual(aggregator.addAttestation(mismatchedAttestation), false);
    assert.strictEqual(aggregator.getCount(), 0);
  });

  it("payload generation error when empty and resets via clear()", () => {
    const aggregator = new ObserverSignatureAggregator();

    assert.throws(
      () => aggregator.toFinalizationPayload(),
      /no attestations have been aggregated/
    );

    aggregator.addAttestation({
      caseId: CASE_A,
      observer: OBSERVER_1,
      commitment: COMMITMENT_1,
      signature: SIG_1,
    });
    assert.strictEqual(aggregator.getCount(), 1);

    aggregator.clear();
    assert.strictEqual(aggregator.getCount(), 0);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_1), false);
    // After clear, re-adding the observer succeeds
    assert.strictEqual(
      aggregator.addAttestation({
        caseId: CASE_A,
        observer: OBSERVER_1,
        commitment: COMMITMENT_1,
        signature: SIG_1,
      }),
      true
    );
  });
});
