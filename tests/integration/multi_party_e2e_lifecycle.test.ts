import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupLiveSettlementEnvironment, TEST_LIVE_CONTRACT_ID, TEST_LIVE_NETWORK } from "./helpers/soroban.js";
import { computeTermsCommitment, computeObservationCommitment } from "@stellarclear/proof";
import type {
  ExpectedSettlement,
  ObservedSettlement,
  SettlementProof,
} from "@stellarclear/schemas";
import { SettlementStateSynchronizer, type DecodedContractEvent } from "@stellarclear/indexer";

const OBSERVER_1 = "GDJEIX4BDUFRKGYP5F74V3Q472K72UAY4OQ7O26U6PZ7VUSZ5JTY4Q4E";
const OBSERVER_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const OBSERVER_3 = "GCKFBEIYV2U22IO2GUOWGQPF7Z3ST6ELDXDOTKOQAXYVU7K3FDNVTGQ4";

describe("Integration & E2E - Multi-Party Attestation & Lifecycle Automation (TASK I)", () => {
  it("executes multi-party attestation with observer quorum: enforcement, failure, and finalization", async () => {
    const { db, soroban, server } = setupLiveSettlementEnvironment();
    const synchronizer = new SettlementStateSynchronizer(db, TEST_LIVE_NETWORK);

    // 1. Identify and register authorized observers in the environment
    soroban.registerObserver(OBSERVER_1);
    soroban.registerObserver(OBSERVER_2);
    soroban.registerObserver(OBSERVER_3);

    const caseId = "e2e0000000000000000000000000000000000000000000000000000000000001";
    const terms: ExpectedSettlement = {
      caseId,
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TR-E2E-QUORUM-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "1000000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-E2E-001",
      deadline: 1900000,
      observerQuorum: 3,
    };

    // 2. Create Case via API with observerQuorum = 3
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms, observerQuorum: 3 },
    });
    assert.strictEqual(createRes.statusCode, 201);

    // Configure quorum on chain
    await soroban.setCaseQuorum(caseId, 3);
    const onchainCase = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainCase?.observerQuorum, 3);

    // 3. Observe Settlement Transaction
    const observation: ObservedSettlement = {
      txHash: "1111111111111111111111111111111111111111111111111111111111111111",
      ledger: 1550000,
      asset: terms.asset,
      amount: terms.amount,
      destination: terms.expectedDestination,
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };

    const obsRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation },
    });
    assert.strictEqual(obsRes.statusCode, 200);

    // 4. Reconcile settlement -> MATCHED
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; matched: boolean };
    assert.strictEqual(recBody.status, "MATCHED");
    assert.strictEqual(recBody.matched, true);

    // 5. Submit Owner Attestation
    const ownerCommitment = computeTermsCommitment(terms);
    const ownerAttRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: terms.owner,
        role: "OWNER",
        commitment: ownerCommitment,
      },
    });
    assert.strictEqual(ownerAttRes.statusCode, 201);

    // 6. Submit Observer 1 Attestation
    const obsCommitment = computeObservationCommitment(observation);
    const obs1Res = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: OBSERVER_1,
        role: "OBSERVER",
        commitment: obsCommitment,
      },
    });
    assert.strictEqual(obs1Res.statusCode, 201);

    // 7. Submit Observer 2 Attestation
    const obs2Res = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: OBSERVER_2,
        role: "OBSERVER",
        commitment: obsCommitment,
      },
    });
    assert.strictEqual(obs2Res.statusCode, 201);

    // 8. Exercise Quorum Logic via API (GET /v1/cases/:caseId/quorum)
    const quorumRes1 = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/quorum`,
    });
    assert.strictEqual(quorumRes1.statusCode, 200);
    const quorumBody1 = quorumRes1.body as {
      requiredObserverQuorum: number;
      distinctObserverCount: number;
      quorumSatisfied: boolean;
    };
    assert.strictEqual(quorumBody1.requiredObserverQuorum, 3);
    assert.strictEqual(quorumBody1.distinctObserverCount, 2);
    assert.strictEqual(quorumBody1.quorumSatisfied, false);

    // 9. Negative Path: Finalization FAILS because quorum (2 < 3) is not met
    const failFinRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/finalize`,
      body: { finalizer: terms.owner },
    });
    assert.strictEqual(failFinRes.statusCode, 409);
    const failBody = failFinRes.body as { error: { code: string } };
    assert.strictEqual(failBody.error.code, "QUORUM_NOT_MET");

    // Ensure chain is NOT finalized
    const onchainNotFinal = await soroban.getOnChainCase(caseId);
    assert.notStrictEqual(onchainNotFinal?.status, "FINALIZED");

    // 10. Submit Duplicate Observer Attestation (OBSERVER_2 submitting again)
    // Duplicate submission must be rejected or not count twice
    const dupRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: OBSERVER_2,
        role: "OBSERVER",
        commitment: obsCommitment,
      },
    });
    // In our API idempotency, duplicate returns 200/409, but distinct count stays 2
    const quorumResDup = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/quorum`,
    });
    const quorumBodyDup = quorumResDup.body as { distinctObserverCount: number; quorumSatisfied: boolean };
    assert.strictEqual(quorumBodyDup.distinctObserverCount, 2);
    assert.strictEqual(quorumBodyDup.quorumSatisfied, false);

    // 11. Submit Observer 3 Attestation (3rd distinct observer)
    const obs3Res = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: OBSERVER_3,
        role: "OBSERVER",
        commitment: obsCommitment,
      },
    });
    assert.strictEqual(obs3Res.statusCode, 201);

    // Verify quorum is now satisfied
    const quorumRes2 = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/quorum`,
    });
    const quorumBody2 = quorumRes2.body as {
      requiredObserverQuorum: number;
      distinctObserverCount: number;
      quorumSatisfied: boolean;
      distinctObservers: string[];
    };
    assert.strictEqual(quorumBody2.requiredObserverQuorum, 3);
    assert.strictEqual(quorumBody2.distinctObserverCount, 3);
    assert.strictEqual(quorumBody2.quorumSatisfied, true);

    // 12. Finalize Case on Soroban -> SUCCEEDS
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/finalize`,
      body: { finalizer: terms.owner },
    });
    assert.strictEqual(finRes.statusCode, 200);
    const finBody = finRes.body as { status: string; finalizedAtLedger?: number };
    assert.strictEqual(finBody.status, "FINALIZED");
    assert.ok(finBody.finalizedAtLedger);

    // 13. Query finalized state: Confirm Finalized is actually present on-chain
    const onchainFinalized = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainFinalized?.status, "FINALIZED");
    assert.strictEqual(onchainFinalized?.finalizedAtLedger, finBody.finalizedAtLedger);

    // 14. Verify SettlementProof against On-Chain State
    const proofRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/proof`,
    });
    assert.strictEqual(proofRes.statusCode, 200);
    const proof = proofRes.body as SettlementProof;
    assert.strictEqual(proof.caseId, caseId);

    const onchainVerifyRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify/onchain",
      body: {
        proof,
        termsDocument: terms,
        observedDocument: observation,
      },
    });
    assert.strictEqual(onchainVerifyRes.statusCode, 200);
    assert.strictEqual((onchainVerifyRes.body as { valid: boolean }).valid, true);

    // 15. Synchronize with Indexer and verify DB consistency
    const event: DecodedContractEvent = {
      type: "CaseFinalized",
      contractId: TEST_LIVE_CONTRACT_ID,
      ledger: Number(finBody.finalizedAtLedger),
      txHash: "0x_e2e_finalized_tx",
      cursor: "cursor-e2e-001",
      topicXdr: "AAA=",
      dataXdr: "BBB=",
      caseId,
      payload: {
        caseId,
        finalizedAtLedger: finBody.finalizedAtLedger,
      },
    };
    await synchronizer.syncBatch([event]);

    const consistencyRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/consistency`,
    });
    assert.strictEqual(consistencyRes.statusCode, 200);
    assert.strictEqual((consistencyRes.body as { isConsistent: boolean }).isConsistent, true);
  });

  it("executes dispute lifecycle: BREAK -> DISPUTED -> 1 resolution (remains DISPUTED) -> 2nd matching -> RESOLVED", async () => {
    const { db, soroban, server } = setupLiveSettlementEnvironment();
    const synchronizer = new SettlementStateSynchronizer(db, TEST_LIVE_NETWORK);

    const caseId = "e2e0000000000000000000000000000000000000000000000000000000000002";
    const terms: ExpectedSettlement = {
      caseId,
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TR-E2E-DISPUTE-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "2000000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-E2E-002",
      deadline: 1900000,
    };

    // 1. Create Case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // 2. Observe Discrepancy (Wrong destination)
    const brokenObs: ObservedSettlement = {
      txHash: "2222222222222222222222222222222222222222222222222222222222222222",
      ledger: 1550010,
      asset: terms.asset,
      amount: terms.amount,
      destination: "GCKFBEIYV2U22IO2GUOWGQPF7Z3ST6ELDXDOTKOQAXYVU7K3FDNVTGQ4", // Mismatch
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };
    await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation: brokenObs },
    });

    // 3. Reconcile -> Produces BREAK
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; breaks?: Array<{ code: string }> };
    assert.strictEqual(recBody.status, "BREAK");
    assert.strictEqual(recBody.breaks?.[0]?.code, "DESTINATION_MISMATCH");

    // 4. Open Dispute from BREAK -> transitions to DISPUTED
    const disputeCommitment = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/dispute`,
      body: {
        initiator: terms.owner,
        reason: "Destination mismatch observed",
        disputeCommitment,
      },
    });
    assert.strictEqual(disputeRes.statusCode, 201);

    // Verify on-chain state is DISPUTED
    const onchainDisputed = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainDisputed?.status, "DISPUTED");

    // 5. Submit FIRST Resolution by Owner -> MUST REMAIN DISPUTED (TASK C)
    const agreedResolutionCommitment = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const firstResRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/resolve`,
      body: {
        resolver: terms.owner,
        resolutionType: "MUTUAL_AGREEMENT",
        resolutionCommitment: agreedResolutionCommitment,
      },
    });
    assert.strictEqual(firstResRes.statusCode, 200);
    const firstResBody = firstResRes.body as { status: string; mutualResolutionAchieved: boolean };
    assert.strictEqual(firstResBody.status, "DISPUTED");
    assert.strictEqual(firstResBody.mutualResolutionAchieved, false);

    // Chain must still be DISPUTED
    const onchainStillDisputed = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainStillDisputed?.status, "DISPUTED");

    // Verify GET /v1/cases/:caseId/dispute reports DISPUTED and single resolution
    const disputeQuery1 = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/dispute`,
    });
    assert.strictEqual(disputeQuery1.statusCode, 200);
    const disputeQueryBody1 = disputeQuery1.body as {
      disputeState: string;
      mutualResolutionAchieved: boolean;
      resolutionCommitmentsObserved: string[];
    };
    assert.strictEqual(disputeQueryBody1.disputeState, "DISPUTED");
    assert.strictEqual(disputeQueryBody1.mutualResolutionAchieved, false);
    assert.strictEqual(disputeQueryBody1.resolutionCommitmentsObserved.length, 1);

    // 6. Submit SECOND Matching Resolution by Counterparty -> transitions to RESOLVED
    const secondResRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/resolve`,
      body: {
        resolver: terms.counterparty!,
        resolutionType: "MUTUAL_AGREEMENT",
        resolutionCommitment: agreedResolutionCommitment,
      },
    });
    assert.strictEqual(secondResRes.statusCode, 200);
    const secondResBody = secondResRes.body as { status: string; mutualResolutionAchieved: boolean };
    assert.strictEqual(secondResBody.status, "RESOLVED");
    assert.strictEqual(secondResBody.mutualResolutionAchieved, true);

    // Chain must now be RESOLVED
    const onchainResolved = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainResolved?.status, "RESOLVED");

    // 7. Indexer syncs DisputeResolved event
    const resolveEvent: DecodedContractEvent = {
      type: "DisputeResolved",
      contractId: TEST_LIVE_CONTRACT_ID,
      ledger: 1550050,
      txHash: "0x_e2e_resolve_tx",
      cursor: "cursor-e2e-002",
      topicXdr: "AAA=",
      dataXdr: "BBB=",
      caseId,
      payload: {
        caseId,
        resolutionCommitment: agreedResolutionCommitment,
      },
    };
    await synchronizer.syncBatch([resolveEvent]);

    // 8. Confirm DB and Chain consistency
    const consistencyRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/consistency`,
    });
    assert.strictEqual(consistencyRes.statusCode, 200);
    assert.strictEqual((consistencyRes.body as { isConsistent: boolean }).isConsistent, true);
  });

  it("executes dispute TTL expiration flow: BREAK -> DISPUTED(with TTL) -> ledger advances -> DisputeExpired -> BREAK", async () => {
    const { db, soroban, server } = setupLiveSettlementEnvironment();
    const synchronizer = new SettlementStateSynchronizer(db, TEST_LIVE_NETWORK);

    const caseId = "e2e0000000000000000000000000000000000000000000000000000000000003";
    const terms: ExpectedSettlement = {
      caseId,
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TR-E2E-EXPIRY-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "50000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-E2E-003",
      deadline: 1900000,
    };

    // 1. Create Case via API
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // 2. Observe mismatch and reconcile to set status to BREAK in DB and on-chain
    const brokenObs: ObservedSettlement = {
      txHash: "3333333333333333333333333333333333333333333333333333333333333333",
      ledger: 1550020,
      asset: terms.asset,
      amount: "99999.00", // Mismatch
      destination: terms.expectedDestination,
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };
    await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation: brokenObs },
    });
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);

    // 3. Open dispute with TTL on-chain directly from BREAK
    const disputeCommitment = "3333333333333333333333333333333333333333333333333333333333333333";
    const ttlLedgers = 100;
    const currentLedger = soroban.currentLedger;
    const expiryLedger = currentLedger + ttlLedgers + 1;
    await soroban.anchorDisputeWithTtl({
      initiator: terms.owner,
      caseId,
      disputeCommitment,
      ttlLedgers,
    });
    await db.query(
      `UPDATE settlement_cases SET status = 'DISPUTED', dispute_expires_at_ledger = $1 WHERE id = $2`,
      [expiryLedger, caseId]
    );

    // Verify on-chain dispute state and expiration ledger
    const disputedCase = await soroban.getOnChainCase(caseId);
    assert.strictEqual(disputedCase?.status, "DISPUTED");
    assert.ok(disputedCase?.disputeExpiresAtLedger);

    // 4. Early expiration attempt before TTL elapses must fail
    await assert.rejects(async () => {
      await soroban.anchorExpireDispute({ caseId });
    }, /DisputeNotExpired/);

    // 5. Advance ledger past the expiration threshold
    soroban.advanceLedger(ttlLedgers + 50);

    // 6. Permissionless expire_dispute succeeds and transitions case back to BREAK on chain
    await soroban.anchorExpireDispute({ caseId });
    const expiredCase = await soroban.getOnChainCase(caseId);
    assert.strictEqual(expiredCase?.status, "BREAK");
    assert.strictEqual(expiredCase?.disputeExpiresAtLedger, undefined);

    // 6. Indexer processes DisputeExpired event
    const expireEvent: DecodedContractEvent = {
      type: "DisputeExpired",
      contractId: TEST_LIVE_CONTRACT_ID,
      ledger: soroban.currentLedger,
      txHash: "0x_e2e_expire_tx",
      cursor: "cursor-e2e-003",
      topicXdr: "AAA=",
      dataXdr: "BBB=",
      caseId,
      payload: {
        caseId,
        expirationLedger: expiryLedger,
        closedAtLedger: soroban.currentLedger,
      },
    };
    const syncRes = await synchronizer.syncBatch([expireEvent]);
    assert.strictEqual(syncRes.eventsProcessed, 1);
    assert.strictEqual(syncRes.casesUpdated, 1);

    // 7. Verify API and DB have case status BREAK and expiration metadata persisted
    const disputeQueryRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/dispute`,
    });
    assert.strictEqual(disputeQueryRes.statusCode, 200);
    const disputeQuery = disputeQueryRes.body as {
      status: string;
      expirationState: string;
      expiredAtLedger?: number | null;
      expiryLedger?: number | null;
    };
    assert.strictEqual(disputeQuery.status, "BREAK");
    assert.strictEqual(disputeQuery.expirationState, "EXPIRED");
    assert.strictEqual(disputeQuery.expiredAtLedger, soroban.currentLedger);

    const expQuery = await db.query(
      `SELECT case_id, expired_at_ledger, tx_hash FROM dispute_expirations WHERE case_id = $1`,
      [caseId]
    );
    assert.strictEqual(expQuery.rows.length, 1);
    assert.strictEqual(Number((expQuery.rows[0] as { expired_at_ledger: number }).expired_at_ledger), soroban.currentLedger);
  });
});
