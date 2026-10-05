import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryDatabaseClient,
  CaseRepository,
  ObservationRepository,
  ReconciliationRepository,
  BreakRepository,
  DisputeRepository,
  ResolutionRepository,
  AttestationRepository,
} from "@stellarclear/db";
import { SettlementStateSynchronizer, type DecodedContractEvent } from "@stellarclear/indexer";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";

describe("Indexer Service - Settlement State Synchronization", () => {
  const caseId = "1010101010101010101010101010101010101010101010101010101010101010";

  function setup() {
    const db = new InMemoryDatabaseClient();
    const caseRepo = new CaseRepository(db);
    const obsRepo = new ObservationRepository(db);
    const recRepo = new ReconciliationRepository(db);
    const breakRepo = new BreakRepository(db);
    const disputeRepo = new DisputeRepository(db);
    const resolutionRepo = new ResolutionRepository(db);
    const attestationRepo = new AttestationRepository(db);
    const synchronizer = new SettlementStateSynchronizer(db, TEST_NETWORK);
    return { db, caseRepo, obsRepo, recRepo, breakRepo, disputeRepo, resolutionRepo, attestationRepo, synchronizer };
  }

  it("synchronizes case creation and updates ledger checkpoints", async () => {
    const { caseRepo, synchronizer } = setup();

    // 1. Initial DB case
    const now = new Date();
    await caseRepo.insert({
      id: caseId,
      network: TEST_NETWORK,
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      trade_reference: "TR-SYNC-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "10000.00",
      expected_destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      terms_commitment: "a".repeat(64),
      expires_at_ledger: 1000000,
      status: "OPEN",
      created_at: now,
      updated_at: now,
    });

    // 2. Process CaseCreated event
    const event: DecodedContractEvent = {
      type: "CaseCreated",
      contractId: TEST_CONTRACT_ID,
      ledger: 990000,
      txHash: "0x_create_tx_hash_1",
      cursor: "cursor_1",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      caseId,
      payload: {
        caseId,
        owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
        expiresAtLedger: 1000000,
      },
    };

    const synced = await synchronizer.syncEvent(event);
    assert.strictEqual(synced, true);

    const updated = await caseRepo.findById(caseId, TEST_NETWORK);
    assert.strictEqual(updated?.create_tx_hash, "0x_create_tx_hash_1");
    assert.strictEqual(Number(updated?.confirmed_at_ledger), 990000);
    assert.strictEqual(updated?.submission_status, "CONFIRMED");
  });

  it("synchronizes observation, match, attestation, and finalization in batch idempotently", async () => {
    const { caseRepo, obsRepo, synchronizer } = setup();

    const now = new Date();
    await caseRepo.insert({
      id: caseId,
      network: TEST_NETWORK,
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      trade_reference: "TR-SYNC-002",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "50000.00",
      expected_destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      terms_commitment: "b".repeat(64),
      expires_at_ledger: 1000000,
      status: "OPEN",
      created_at: now,
      updated_at: now,
    });

    await obsRepo.insert({
      network: TEST_NETWORK,
      case_id: caseId,
      observer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      tx_hash: "tx_obs_123",
      observed_ledger: 991000,
      observation_commitment: "c".repeat(64),
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "50000.00",
      destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      status: "SUCCESS",
      observed_at: now,
    });

    const events: DecodedContractEvent[] = [
      {
        type: "ObservationRecorded",
        contractId: TEST_CONTRACT_ID,
        ledger: 991000,
        txHash: "0x_obs_tx_chain",
        cursor: "cursor_2",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId,
        payload: { caseId, observer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ", observedLedger: 991000 },
      },
      {
        type: "CaseMatched",
        contractId: TEST_CONTRACT_ID,
        ledger: 992000,
        txHash: "0x_match_tx_chain",
        cursor: "cursor_3",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId,
        payload: { caseId, observer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ" },
      },
      {
        type: "AttestationSubmitted",
        contractId: TEST_CONTRACT_ID,
        ledger: 993000,
        txHash: "0x_attest_tx_chain",
        cursor: "cursor_4",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId,
        payload: { caseId, attestor: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ", role: "OWNER" },
      },
      {
        type: "CaseFinalized",
        contractId: TEST_CONTRACT_ID,
        ledger: 994000,
        txHash: "0x_finalize_tx_chain",
        cursor: "cursor_5",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId,
        payload: { caseId, finalizedAtLedger: 994000 },
      },
    ];

    const stats = await synchronizer.syncBatch(events);
    assert.strictEqual(stats.eventsProcessed, 4);
    assert.strictEqual(stats.casesUpdated, 4);
    assert.strictEqual(stats.lastLedgerSequence, 994000);

    const finalizedCase = await caseRepo.findById(caseId, TEST_NETWORK);
    assert.strictEqual(finalizedCase?.status, "FINALIZED");
    assert.strictEqual(finalizedCase?.observation_tx_hash, "0x_obs_tx_chain");
    assert.strictEqual(finalizedCase?.reconciliation_tx_hash, "0x_match_tx_chain");
    assert.strictEqual(finalizedCase?.attestation_tx_hash, "0x_attest_tx_chain");
    assert.strictEqual(finalizedCase?.finalization_tx_hash, "0x_finalize_tx_chain");
    assert.strictEqual(Number(finalizedCase?.finalized_at_ledger), 994000);

    // Replay same batch - must be completely idempotent
    const replayStats = await synchronizer.syncBatch(events);
    assert.strictEqual(replayStats.eventsProcessed, 4);

    const replayedCase = await caseRepo.findById(caseId, TEST_NETWORK);
    assert.strictEqual(replayedCase?.status, "FINALIZED");
    assert.strictEqual(replayedCase?.finalization_tx_hash, "0x_finalize_tx_chain");
  });

  it("discovers on-chain case and observation when no prior database record exists", async () => {
    const { caseRepo, obsRepo, synchronizer } = setup();
    const externalCaseId = "2020202020202020202020202020202020202020202020202020202020202020";

    // 1. Process CaseCreated for an unrecorded case
    const caseCreatedEvent: DecodedContractEvent = {
      type: "CaseCreated",
      contractId: TEST_CONTRACT_ID,
      ledger: 888000,
      txHash: "0x_ext_create_tx",
      cursor: "cursor_ext_1",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      caseId: externalCaseId,
      payload: {
        caseId: externalCaseId,
        owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
        counterparty: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JIBKTRUXZLVTH5",
        tradeReference: "TR-CHAIN-DISCOVERED",
        asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "75000.00",
        expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
        termsCommitment: "d".repeat(64),
        expiresAtLedger: 999999,
      },
    };

    const caseSynced = await synchronizer.syncEvent(caseCreatedEvent);
    assert.strictEqual(caseSynced, true);

    const createdCase = await caseRepo.findById(externalCaseId, TEST_NETWORK);
    assert.ok(createdCase);
    assert.strictEqual(createdCase!.id, externalCaseId);
    assert.strictEqual(createdCase!.trade_reference, "TR-CHAIN-DISCOVERED");
    assert.strictEqual(createdCase!.status, "OPEN");
    assert.strictEqual(createdCase!.submission_status, "CONFIRMED");
    assert.strictEqual(createdCase!.create_tx_hash, "0x_ext_create_tx");
    assert.strictEqual(Number(createdCase!.confirmed_at_ledger), 888000);

    // 2. Process ObservationRecorded for unrecorded observation
    const obsEvent: DecodedContractEvent = {
      type: "ObservationRecorded",
      contractId: TEST_CONTRACT_ID,
      ledger: 888500,
      txHash: "0x_ext_obs_tx",
      cursor: "cursor_ext_2",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      caseId: externalCaseId,
      payload: {
        caseId: externalCaseId,
        observer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
        txHash: "0x_payment_tx",
        observedLedger: 888400,
        observationCommitment: "e".repeat(64),
        asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "75000.00",
        destination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      },
    };

    const obsSynced = await synchronizer.syncEvent(obsEvent);
    assert.strictEqual(obsSynced, true);

    const createdObs = await obsRepo.findByCaseId(externalCaseId, TEST_NETWORK);
    assert.ok(createdObs);
    assert.strictEqual(createdObs!.case_id, externalCaseId);
    assert.strictEqual(createdObs!.observer, "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ");
    assert.strictEqual(createdObs!.observation_tx_hash, "0x_ext_obs_tx");
    assert.strictEqual(Number(createdObs!.confirmed_at_ledger), 888500);

    // 3. Process ObserverAdded/ObserverRemoved events
    const observerEvent: DecodedContractEvent = {
      type: "ObserverAdded",
      contractId: TEST_CONTRACT_ID,
      ledger: 888600,
      txHash: "0x_observer_tx",
      cursor: "cursor_ext_3",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      payload: {
        observer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      },
    };
    const observerSynced = await synchronizer.syncEvent(observerEvent);
    assert.strictEqual(observerSynced, true);
  });

  it("handles out-of-order events gracefully without regressing status or dropping case metadata", async () => {
    const { caseRepo, recRepo, synchronizer } = setup();
    const outOfOrderCaseId = "3030303030303030303030303030303030303030303030303030303030303030";

    // 1. CaseMatched arrives BEFORE CaseCreated (e.g. indexer lag or out-of-order batch delivery)
    const matchEvent: DecodedContractEvent = {
      type: "CaseMatched",
      contractId: TEST_CONTRACT_ID,
      ledger: 777200,
      txHash: "0x_match_first",
      cursor: "cursor_ooo_1",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      caseId: outOfOrderCaseId,
      payload: { caseId: outOfOrderCaseId },
    };

    const matchSynced = await synchronizer.syncEvent(matchEvent);
    assert.strictEqual(matchSynced, true);

    const initialCase = await caseRepo.findById(outOfOrderCaseId, TEST_NETWORK);
    assert.ok(initialCase);
    assert.strictEqual(initialCase!.status, "MATCHED");
    assert.strictEqual(initialCase!.reconciliation_tx_hash, "0x_match_first");

    const initialRec = await recRepo.findByCaseId(outOfOrderCaseId, TEST_NETWORK);
    assert.ok(initialRec);
    assert.strictEqual(initialRec!.matched, true);
    assert.strictEqual(initialRec!.status, "MATCHED");

    // 2. CaseCreated arrives LATER
    const createdEvent: DecodedContractEvent = {
      type: "CaseCreated",
      contractId: TEST_CONTRACT_ID,
      ledger: 777000,
      txHash: "0x_create_later",
      cursor: "cursor_ooo_2",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      caseId: outOfOrderCaseId,
      payload: {
        caseId: outOfOrderCaseId,
        owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
        counterparty: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JIBKTRUXZLVTH5",
        tradeReference: "TR-OOO-001",
        asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "125000.00",
        expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
        termsCommitment: "f".repeat(64),
        expiresAtLedger: 999999,
      },
    };

    const createdSynced = await synchronizer.syncEvent(createdEvent);
    assert.strictEqual(createdSynced, true);

    // Case metadata should now be populated, and status must remain MATCHED (no regression to OPEN)
    const enrichedCase = await caseRepo.findById(outOfOrderCaseId, TEST_NETWORK);
    assert.ok(enrichedCase);
    assert.strictEqual(enrichedCase!.status, "MATCHED");
    assert.strictEqual(enrichedCase!.trade_reference, "TR-OOO-001");
    assert.strictEqual(enrichedCase!.owner, "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ");
    assert.strictEqual(enrichedCase!.create_tx_hash, "0x_create_later");
    assert.strictEqual(enrichedCase!.reconciliation_tx_hash, "0x_match_first");
  });

  it("reconstructs break, dispute, resolution, and finalization lifecycle completely from on-chain events", async () => {
    const { caseRepo, recRepo, breakRepo, disputeRepo, resolutionRepo, synchronizer } = setup();
    const breakCaseId = "4040404040404040404040404040404040404040404040404040404040404040";

    const lifecycleEvents: DecodedContractEvent[] = [
      {
        type: "CaseCreated",
        contractId: TEST_CONTRACT_ID,
        ledger: 600000,
        txHash: "0x_break_create",
        cursor: "cur_1",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId: breakCaseId,
        payload: {
          caseId: breakCaseId,
          owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
          tradeReference: "TR-BREAK-001",
          asset: "XLM",
          amount: "1000",
          termsCommitment: "1".repeat(64),
        },
      },
      {
        type: "ObservationRecorded",
        contractId: TEST_CONTRACT_ID,
        ledger: 600100,
        txHash: "0x_break_obs",
        cursor: "cur_2",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId: breakCaseId,
        payload: {
          caseId: breakCaseId,
          observer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
          txHash: "0x_mismatched_tx",
          observedLedger: 600050,
          observationCommitment: "2".repeat(64),
          asset: "XLM",
          amount: "800",
        },
      },
      {
        type: "CaseBroken",
        contractId: TEST_CONTRACT_ID,
        ledger: 600200,
        txHash: "0x_break_rec",
        cursor: "cur_3",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId: breakCaseId,
        payload: {
          caseId: breakCaseId,
          breakCode: "AMOUNT_MISMATCH",
        },
      },
      {
        type: "DisputeOpened",
        contractId: TEST_CONTRACT_ID,
        ledger: 600300,
        txHash: "0x_break_dispute",
        cursor: "cur_4",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId: breakCaseId,
        payload: {
          caseId: breakCaseId,
          initiator: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
          disputeCommitment: "3".repeat(64),
        },
      },
      {
        type: "ResolutionSubmitted",
        contractId: TEST_CONTRACT_ID,
        ledger: 600400,
        txHash: "0x_break_resolution",
        cursor: "cur_5",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId: breakCaseId,
        payload: {
          caseId: breakCaseId,
          resolver: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
          resolutionCommitment: "4".repeat(64),
        },
      },
      {
        type: "DisputeResolved",
        contractId: TEST_CONTRACT_ID,
        ledger: 600500,
        txHash: "0x_break_resolved",
        cursor: "cur_6",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId: breakCaseId,
        payload: {
          caseId: breakCaseId,
          resolutionCommitment: "4".repeat(64),
        },
      },
      {
        type: "CaseFinalized",
        contractId: TEST_CONTRACT_ID,
        ledger: 600600,
        txHash: "0x_break_finalized",
        cursor: "cur_7",
        topicXdr: "AAAAAA==",
        dataXdr: "AAAAAA==",
        caseId: breakCaseId,
        payload: {
          caseId: breakCaseId,
          finalizedAtLedger: 600600,
        },
      },
    ];

    const stats = await synchronizer.syncBatch(lifecycleEvents);
    assert.strictEqual(stats.eventsProcessed, 7);
    assert.strictEqual(stats.casesUpdated, 7);

    // Verify all reconstructed entities
    const dbCase = await caseRepo.findById(breakCaseId, TEST_NETWORK);
    assert.ok(dbCase);
    assert.strictEqual(dbCase!.status, "FINALIZED");
    assert.strictEqual(dbCase!.create_tx_hash, "0x_break_create");
    assert.strictEqual(dbCase!.observation_tx_hash, "0x_break_obs");
    assert.strictEqual(dbCase!.reconciliation_tx_hash, "0x_break_rec");
    assert.strictEqual(dbCase!.dispute_tx_hash, "0x_break_dispute");
    assert.strictEqual(dbCase!.resolution_tx_hash, "0x_break_resolved");
    assert.strictEqual(dbCase!.finalization_tx_hash, "0x_break_finalized");

    const dbRec = await recRepo.findByCaseId(breakCaseId, TEST_NETWORK);
    assert.ok(dbRec);
    assert.strictEqual(dbRec!.matched, false);
    assert.strictEqual(dbRec!.status, "BREAK");

    const breaks = await breakRepo.findByCaseId(breakCaseId, TEST_NETWORK);
    assert.strictEqual(breaks.length, 1);
    assert.strictEqual(breaks[0].code, "AMOUNT_MISMATCH");

    const disputes = await disputeRepo.findByCaseId(breakCaseId, TEST_NETWORK);
    assert.strictEqual(disputes.length, 1);
    assert.strictEqual(disputes[0].dispute_commitment, "3".repeat(64));

    const resolutions = await resolutionRepo.findByCaseId(breakCaseId, TEST_NETWORK);
    assert.strictEqual(resolutions.length, 1);
    assert.strictEqual(resolutions[0].resolution_commitment, "4".repeat(64));

    // Replay older event (e.g. ObservationRecorded or CaseBroken) - status must NOT regress from FINALIZED
    const replayedObs = await synchronizer.syncEvent(lifecycleEvents[1]);
    assert.strictEqual(replayedObs, true);

    const postReplayCase = await caseRepo.findById(breakCaseId, TEST_NETWORK);
    assert.strictEqual(postReplayCase!.status, "FINALIZED");
  });

  it("DisputeExpired returns DISPUTED case to BREAK, records expiration idempotently and never regresses FINALIZED", async () => {
    const { caseRepo, synchronizer, db } = setup();
    const expCaseId = "2020202020202020202020202020202020202020202020202020202020202020";
    const owner = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ";
    const now = new Date();
    await caseRepo.insert({
      id: expCaseId,
      network: TEST_NETWORK,
      owner,
      trade_reference: "TR-EXP-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "1.00",
      expected_destination: owner,
      terms_commitment: "e".repeat(64),
      expires_at_ledger: 1000000,
      status: "DISPUTED",
      created_at: now,
      updated_at: now,
    });
    await caseRepo.updateDisputeExpiration(expCaseId, TEST_NETWORK, 700100);

    const expiredEvent: DecodedContractEvent = {
      type: "DisputeExpired",
      contractId: TEST_CONTRACT_ID,
      ledger: 700200,
      txHash: "0x_expire_tx",
      cursor: "exp_cur_1",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      caseId: expCaseId,
      payload: { caseId: expCaseId, expirationLedger: 700100, closedAtLedger: 700200 },
    };

    assert.strictEqual(await synchronizer.syncEvent(expiredEvent), true);
    const afterFirst = await caseRepo.findById(expCaseId, TEST_NETWORK);
    assert.strictEqual(afterFirst!.status, "BREAK");
    assert.strictEqual(afterFirst!.dispute_expires_at_ledger ?? null, null);

    // Duplicate delivery is idempotent
    assert.strictEqual(await synchronizer.syncEvent(expiredEvent), true);
    const rows = db.getTable("dispute_expirations").filter((r) => r["case_id"] === expCaseId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(Number(rows[0]["expired_at_ledger"]), 700200);
    assert.strictEqual(rows[0]["event_cursor"], "exp_cur_1");

    // A replayed DisputeExpired must not regress a FINALIZED case
    await caseRepo.updateStatus(expCaseId, TEST_NETWORK, "FINALIZED", 700300);
    await synchronizer.syncEvent(expiredEvent);
    const finalCase = await caseRepo.findById(expCaseId, TEST_NETWORK);
    assert.strictEqual(finalCase!.status, "FINALIZED");
  });

  it("CaseQuorumSet updates the observer quorum of the case", async () => {
    const { caseRepo, synchronizer } = setup();
    const qCaseId = "3030303030303030303030303030303030303030303030303030303030303030";
    const owner = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ";
    const now = new Date();
    await caseRepo.insert({
      id: qCaseId,
      network: TEST_NETWORK,
      owner,
      trade_reference: "TR-Q-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "1.00",
      expected_destination: owner,
      terms_commitment: "f".repeat(64),
      expires_at_ledger: 1000000,
      status: "OPEN",
      observer_quorum: 1,
      created_at: now,
      updated_at: now,
    });

    await synchronizer.syncEvent({
      type: "CaseQuorumSet",
      contractId: TEST_CONTRACT_ID,
      ledger: 710000,
      txHash: "0x_quorum_tx",
      cursor: "q_cur_1",
      topicXdr: "AAAAAA==",
      dataXdr: "AAAAAA==",
      caseId: qCaseId,
      payload: { caseId: qCaseId, quorum: 3 },
    });

    const updated = await caseRepo.findById(qCaseId, TEST_NETWORK);
    assert.strictEqual(Number(updated!.observer_quorum), 3);
  });
});


