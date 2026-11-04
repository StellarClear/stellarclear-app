import { Buffer } from "buffer";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import {
  ObserverSignatureAggregator,
  type ObserverAttestation,
} from "@stellarclear/sdk";

const CASE_ID_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CASE_ID_B = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

const KEYPAIR_ALICE = Keypair.random();
const KEYPAIR_BOB = Keypair.random();
const KEYPAIR_CHARLIE = Keypair.random();
const KEYPAIR_DAVE = Keypair.random();

const OBSERVER_ALICE = KEYPAIR_ALICE.publicKey();
const OBSERVER_BOB = KEYPAIR_BOB.publicKey();
const OBSERVER_CHARLIE = KEYPAIR_CHARLIE.publicKey();
const OBSERVER_DAVE = KEYPAIR_DAVE.publicKey();

const COMMITMENT_1 = "1111111111111111111111111111111111111111111111111111111111111111";
const COMMITMENT_2 = "2222222222222222222222222222222222222222222222222222222222222222";
const COMMITMENT_3 = "3333333333333333333333333333333333333333333333333333333333333333";

function signAttestation(keypair: Keypair, caseId: string, commitment: string): string {
  const data = Buffer.from(`${caseId.toLowerCase()}:${commitment.toLowerCase()}`, "utf-8");
  return Buffer.from(keypair.sign(data)).toString("hex");
}

describe("SDK Package - ObserverSignatureAggregator", () => {
  it("initializes empty aggregator and dynamically binds caseId from first attestation", () => {
    const aggregator = new ObserverSignatureAggregator();
    assert.strictEqual(aggregator.caseId, undefined);
    assert.strictEqual(aggregator.size, 0);

    const added = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
    });

    assert.strictEqual(added, true);
    assert.strictEqual(aggregator.caseId, CASE_ID_A);
    assert.strictEqual(aggregator.size, 1);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_ALICE), true);
  });

  it("strictly enforces caseId consistency across submissions", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    // Mismatched case ID must be rejected
    const rejected = aggregator.addAttestation({
      caseId: CASE_ID_B,
      observer: OBSERVER_BOB,
      commitment: COMMITMENT_2,
    });
    assert.strictEqual(rejected, false);
    assert.strictEqual(aggregator.size, 0);

    // Matching case ID is accepted
    const accepted = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_BOB,
      commitment: COMMITMENT_2,
    });
    assert.strictEqual(accepted, true);
    assert.strictEqual(aggregator.size, 1);
  });

  it("does not bind caseId if attestation is rejected due to whitelist or invalid parameters", () => {
    const aggregator = new ObserverSignatureAggregator({
      activeWhitelist: [OBSERVER_ALICE],
    });
    assert.strictEqual(aggregator.caseId, undefined);

    const rejected = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_DAVE,
      commitment: COMMITMENT_1,
    });
    assert.strictEqual(rejected, false);
    assert.strictEqual(aggregator.caseId, undefined);

    const accepted = aggregator.addAttestation({
      caseId: CASE_ID_B,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_2,
    });
    assert.strictEqual(accepted, true);
    assert.strictEqual(aggregator.caseId, CASE_ID_B);
  });

  it("rejects BigInt in metadata without throwing, preserving unbound caseId and zero size", () => {
    const aggregator = new ObserverSignatureAggregator();
    const rejected = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
      metadata: { big: 100n },
    });
    assert.strictEqual(rejected, false);
    assert.strictEqual(aggregator.size, 0);
    assert.strictEqual(aggregator.caseId, undefined);
  });

  it("rejects function in metadata without throwing, preserving unbound caseId and zero size", () => {
    const aggregator = new ObserverSignatureAggregator();
    const rejected = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
      metadata: { fn: () => {} },
    });
    assert.strictEqual(rejected, false);
    assert.strictEqual(aggregator.size, 0);
    assert.strictEqual(aggregator.caseId, undefined);
  });

  it("rejects SharedArrayBuffer in metadata without throwing, preserving unbound caseId and zero size", () => {
    const aggregator = new ObserverSignatureAggregator();
    const shared = new SharedArrayBuffer(4);
    const rejected = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
      metadata: { shared },
    });
    assert.strictEqual(rejected, false);
    assert.strictEqual(aggregator.size, 0);
    assert.strictEqual(aggregator.caseId, undefined);
  });

  it("rejects malformed, non-string, or incomplete attestations without throwing", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    assert.strictEqual(aggregator.addAttestation(null as any), false);
    assert.strictEqual(aggregator.addAttestation(undefined as any), false);
    assert.strictEqual(aggregator.addAttestation({} as any), false);
    assert.strictEqual(
      aggregator.addAttestation({ caseId: 123 as any, observer: OBSERVER_ALICE, commitment: COMMITMENT_1 }),
      false
    );
    assert.strictEqual(
      aggregator.addAttestation({ caseId: CASE_ID_A, observer: {} as any, commitment: COMMITMENT_1 }),
      false
    );
    assert.strictEqual(
      aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_ALICE, commitment: [] as any }),
      false
    );
    assert.strictEqual(
      aggregator.addAttestation({ caseId: "", observer: OBSERVER_ALICE, commitment: COMMITMENT_1 }),
      false
    );
    assert.strictEqual(
      aggregator.addAttestation({ caseId: CASE_ID_A, observer: "", commitment: COMMITMENT_1 }),
      false
    );
    assert.strictEqual(
      aggregator.addAttestation({ caseId: CASE_ID_A, observer: "INVALID_STELLAR_KEY", commitment: COMMITMENT_1 }),
      false
    );
    assert.strictEqual(aggregator.size, 0);
  });

  it("strictly deduplicates signatures from identical observer public keys", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    const first = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
      attestedAtLedger: 100,
    });
    assert.strictEqual(first, true);
    assert.strictEqual(aggregator.size, 1);

    const duplicate = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_2,
      attestedAtLedger: 105,
    });
    assert.strictEqual(duplicate, false);
    assert.strictEqual(aggregator.size, 1);

    const stored = aggregator.getAttestation(OBSERVER_ALICE);
    assert.ok(stored);
    assert.strictEqual(stored?.commitment, COMMITMENT_1);
    assert.strictEqual(stored?.attestedAtLedger, 100);
  });

  it("protects internal state against deep nested external mutations", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    const input: ObserverAttestation = {
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
      metadata: {
        nested: {
          value: 1,
          items: ["alpha", "beta"],
        },
      },
    };

    aggregator.addAttestation(input);

    input.commitment = "mutated_commitment";
    (input.metadata as any).nested.value = 999;
    (input.metadata as any).nested.items.push("gamma");

    const stored = aggregator.getAttestation(OBSERVER_ALICE);
    assert.strictEqual(stored?.commitment, COMMITMENT_1);
    assert.strictEqual((stored?.metadata as any)?.nested?.value, 1);
    assert.deepStrictEqual((stored?.metadata as any)?.nested?.items, ["alpha", "beta"]);

    const list = aggregator.getAttestations();
    (list[0].metadata as any).nested.value = 777;

    const fromPayload = aggregator.toFinalizationPayload();
    assert.strictEqual((fromPayload.attestations[0].metadata as any)?.nested?.value, 1);
  });

  it("cryptographically verifies Ed25519 signatures when enabled", () => {
    const aggregator = new ObserverSignatureAggregator({
      caseId: CASE_ID_A,
      verifySignatures: true,
    });

    const validSig = signAttestation(KEYPAIR_ALICE, CASE_ID_A, COMMITMENT_1);
    const invalidSig = signAttestation(KEYPAIR_BOB, CASE_ID_A, COMMITMENT_1);

    const rejected = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
      signature: invalidSig,
    });
    assert.strictEqual(rejected, false);
    assert.strictEqual(aggregator.size, 0);

    const accepted = aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
      signature: validSig,
    });
    assert.strictEqual(accepted, true);
    assert.strictEqual(aggregator.size, 1);
  });

  it("evaluates quorum threshold satisfaction without whitelist", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    assert.strictEqual(aggregator.validateQuorum(1), false);
    assert.strictEqual(aggregator.validateQuorum(0), false);

    aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_ALICE,
      commitment: COMMITMENT_1,
    });
    assert.strictEqual(aggregator.validateQuorum(1), true);
    assert.strictEqual(aggregator.validateQuorum(2), false);

    aggregator.addAttestation({
      caseId: CASE_ID_A,
      observer: OBSERVER_BOB,
      commitment: COMMITMENT_2,
    });
    assert.strictEqual(aggregator.validateQuorum(2), true);
    assert.strictEqual(aggregator.validateQuorum(3), false);
  });

  it("enforces active whitelist during quorum verification", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_ALICE, commitment: COMMITMENT_1 });
    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_BOB, commitment: COMMITMENT_2 });
    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_DAVE, commitment: COMMITMENT_3 });

    const activeWhitelist = [OBSERVER_ALICE, OBSERVER_BOB, OBSERVER_CHARLIE];

    assert.strictEqual(aggregator.validateQuorum(2, activeWhitelist), true);
    assert.strictEqual(aggregator.validateQuorum(3, activeWhitelist), false);
  });

  it("guarantees deterministic lexicographical ordering in finalization payload", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_DAVE, commitment: COMMITMENT_3 });
    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_BOB, commitment: COMMITMENT_2 });
    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_ALICE, commitment: COMMITMENT_1 });

    const payload = aggregator.toFinalizationPayload();

    assert.strictEqual(payload.caseId, CASE_ID_A);
    assert.strictEqual(payload.observerCount, 3);

    const expectedOrder = [OBSERVER_ALICE, OBSERVER_BOB, OBSERVER_DAVE].sort();
    assert.deepStrictEqual(payload.observers, expectedOrder);
    assert.strictEqual(payload.attestations[0].observer, expectedOrder[0]);
    assert.strictEqual(payload.attestations[1].observer, expectedOrder[1]);
    assert.strictEqual(payload.attestations[2].observer, expectedOrder[2]);
  });

  it("filters out unwhitelisted observers in toFinalizationPayload when whitelist provided", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);

    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_ALICE, commitment: COMMITMENT_1 });
    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_BOB, commitment: COMMITMENT_2 });
    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_DAVE, commitment: COMMITMENT_3 });

    const whitelist = [OBSERVER_ALICE, OBSERVER_BOB];
    const payload = aggregator.toFinalizationPayload(whitelist);

    assert.strictEqual(payload.observerCount, 2);
    assert.deepStrictEqual(payload.observers, [OBSERVER_ALICE, OBSERVER_BOB].sort());
    assert.ok(!payload.observers.includes(OBSERVER_DAVE));
  });

  it("supports clearing and resetting state", () => {
    const aggregator = new ObserverSignatureAggregator(CASE_ID_A);
    aggregator.addAttestation({ caseId: CASE_ID_A, observer: OBSERVER_ALICE, commitment: COMMITMENT_1 });
    assert.strictEqual(aggregator.size, 1);

    aggregator.clear();
    assert.strictEqual(aggregator.size, 0);
    assert.strictEqual(aggregator.hasObserver(OBSERVER_ALICE), false);
  });
});
