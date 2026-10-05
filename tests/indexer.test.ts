import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDatabaseClient,
  CaseRepository,
  ContractEventRepository,
  CursorRepository,
} from "@stellarclear/db";
import {
  IndexerService,
  decodeContractEvent,
  type RawStellarEvent,
} from "@stellarclear/indexer";

const VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const VALID_CASE_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_OWNER = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEWBIXXX";
const VALID_OBSERVER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_TX_HASH = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("Indexer Service - Event Decoding", () => {
  it("decodes CaseCreated event", () => {
    const raw: RawStellarEvent = {
      type: "contract",
      ledger: 1000,
      contractId: VALID_CONTRACT_ID,
      id: "0000001000-0000000001",
      topic: ["CaseCreated", VALID_CASE_ID],
      value: {
        owner: VALID_OWNER,
        counterparty: null,
        expires_at_ledger: 1050,
      },
    };

    const decoded = decodeContractEvent(raw);
    assert.ok(decoded);
    if (decoded) {
      assert.strictEqual(decoded.type, "CaseCreated");
      assert.strictEqual(decoded.caseId, VALID_CASE_ID);
      assert.strictEqual(decoded.payload["owner"], VALID_OWNER);
      assert.strictEqual(decoded.payload["expiresAtLedger"], 1050);
    }
  });

  it("decodes CaseBroken event with break code tag", () => {
    const raw: RawStellarEvent = {
      type: "contract",
      ledger: 1010,
      contractId: VALID_CONTRACT_ID,
      id: "0000001010-0000000001",
      topic: ["CaseBroken", VALID_CASE_ID],
      value: {
        observer: VALID_OBSERVER,
        break_code: { tag: "AmountMismatch", values: undefined },
      },
    };

    const decoded = decodeContractEvent(raw);
    assert.ok(decoded);
    if (decoded) {
      assert.strictEqual(decoded.type, "CaseBroken");
      assert.strictEqual(decoded.payload["breakCode"], "AMOUNT_MISMATCH");
    }
  });

  it("returns null for malformed or unknown events without crashing", () => {
    assert.strictEqual(decodeContractEvent({} as RawStellarEvent), null);
    assert.strictEqual(
      decodeContractEvent({
        type: "contract",
        ledger: 1000,
        contractId: VALID_CONTRACT_ID,
        id: "cursor-1",
        topic: ["UnknownEvent"],
      }),
      null
    );
  });
  it("decodes DisputeExpired event", () => {
    const decoded = decodeContractEvent({
      type: "contract",
      ledger: 1100,
      contractId: VALID_CONTRACT_ID,
      id: "0000001100-0000000001",
      topic: ["DisputeExpired", VALID_CASE_ID],
      value: { expiration_ledger: 1090, closed_at_ledger: 1100 },
    });
    assert.ok(decoded);
    assert.strictEqual(decoded!.type, "DisputeExpired");
    assert.strictEqual(decoded!.caseId, VALID_CASE_ID);
    assert.strictEqual(decoded!.payload["expirationLedger"], 1090);
    assert.strictEqual(decoded!.payload["closedAtLedger"], 1100);
  });

  it("decodes CaseQuorumSet event", () => {
    const decoded = decodeContractEvent({
      type: "contract",
      ledger: 1101,
      contractId: VALID_CONTRACT_ID,
      id: "0000001101-0000000001",
      topic: ["CaseQuorumSet", VALID_CASE_ID],
      value: { quorum: 3 },
    });
    assert.ok(decoded);
    assert.strictEqual(decoded!.type, "CaseQuorumSet");
    assert.strictEqual(decoded!.payload["quorum"], 3);
  });
});


describe("Indexer Service - Ingestion, Idempotency & Recovery", () => {
  it("ingests a batch of events and advances cursor", async () => {
    const dbClient = createDatabaseClient({
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/stellarclear_test",
      network: "testnet",
    });

    const caseRepo = new CaseRepository(dbClient);
    await caseRepo.insert({
      id: VALID_CASE_ID,
      network: "testnet",
      owner: VALID_OWNER,
      trade_reference: "TR-100",
      asset: "USDC",
      amount: "100.0000000",
      expected_destination: VALID_OWNER,
      terms_commitment: VALID_CASE_ID,
      expires_at_ledger: 1050,
      status: "OPEN",
      created_at: new Date(),
      updated_at: new Date(),
    });

    const indexer = new IndexerService(dbClient, {
      network: "testnet",
      contractId: VALID_CONTRACT_ID,
    });
    await indexer.init();

    const batch: RawStellarEvent[] = [
      {
        type: "contract",
        ledger: 1001,
        contractId: VALID_CONTRACT_ID,
        id: "0000001001-0000000001",
        txHash: VALID_TX_HASH,
        topic: ["ObservationRecorded", VALID_CASE_ID],
        value: {
          observer: VALID_OBSERVER,
          tx_hash: VALID_TX_HASH,
          observed_ledger: 1001,
        },
      },
      {
        type: "contract",
        ledger: 1002,
        contractId: VALID_CONTRACT_ID,
        id: "0000001002-0000000001",
        txHash: VALID_TX_HASH,
        topic: ["CaseMatched", VALID_CASE_ID],
        value: {
          observer: VALID_OBSERVER,
        },
      },
    ];

    const res = await indexer.ingestBatch(batch);
    assert.strictEqual(res.ingestedCount, 2);
    assert.strictEqual(res.errors.length, 0);

    // Case status and chain references should now be updated
    const updatedCase = await caseRepo.findById(VALID_CASE_ID, "testnet");
    assert.strictEqual(updatedCase?.status, "MATCHED");
    assert.strictEqual(updatedCase?.observation_tx_hash, VALID_TX_HASH);
    assert.strictEqual(updatedCase?.reconciliation_tx_hash, VALID_TX_HASH);
    assert.strictEqual(Number(updatedCase?.confirmed_at_ledger), 1002);

    // Cursor should be at ledger 1002
    assert.strictEqual(indexer.cursor.ledger, 1002);
  });

  it("ingests full settlement lifecycle events updating all chain references", async () => {
    const dbClient = createDatabaseClient({
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/stellarclear_test",
      network: "testnet",
    });

    const caseRepo = new CaseRepository(dbClient);
    await caseRepo.insert({
      id: "case-lifecycle-999",
      network: "testnet",
      owner: VALID_OWNER,
      trade_reference: "TR-LIFECYCLE-999",
      asset: "USDC",
      amount: "500.0000000",
      expected_destination: VALID_OWNER,
      terms_commitment: "case-lifecycle-999",
      expires_at_ledger: 2000,
      status: "OPEN",
      created_at: new Date(),
      updated_at: new Date(),
    });

    const indexer = new IndexerService(dbClient, {
      network: "testnet",
      contractId: VALID_CONTRACT_ID,
    });
    await indexer.init();

    const lifecycleBatch: RawStellarEvent[] = [
      {
        type: "contract",
        ledger: 1010,
        contractId: VALID_CONTRACT_ID,
        id: "0000001010-0000000001",
        txHash: "tx_create_hash_999",
        topic: ["CaseCreated", "case-lifecycle-999"],
        value: { owner: VALID_OWNER, expires_at_ledger: 2000 },
      },
      {
        type: "contract",
        ledger: 1011,
        contractId: VALID_CONTRACT_ID,
        id: "0000001011-0000000001",
        txHash: "tx_obs_hash_999",
        topic: ["ObservationRecorded", "case-lifecycle-999"],
        value: { observer: VALID_OBSERVER, tx_hash: "tx_obs_hash_999", observed_ledger: 1011 },
      },
      {
        type: "contract",
        ledger: 1012,
        contractId: VALID_CONTRACT_ID,
        id: "0000001012-0000000001",
        txHash: "tx_attest_hash_999",
        topic: ["AttestationSubmitted", "case-lifecycle-999"],
        value: { attestor: VALID_OWNER, role: "OWNER" },
      },
      {
        type: "contract",
        ledger: 1013,
        contractId: VALID_CONTRACT_ID,
        id: "0000001013-0000000001",
        txHash: "tx_final_hash_999",
        topic: ["CaseFinalized", "case-lifecycle-999"],
        value: { finalized_at_ledger: 1013 },
      },
    ];

    const res = await indexer.ingestBatch(lifecycleBatch);
    assert.strictEqual(res.ingestedCount, 4);
    assert.strictEqual(res.errors.length, 0);

    const finalizedCase = await caseRepo.findById("case-lifecycle-999", "testnet");
    assert.strictEqual(finalizedCase?.status, "FINALIZED");
    assert.strictEqual(finalizedCase?.create_tx_hash, "tx_create_hash_999");
    assert.strictEqual(finalizedCase?.observation_tx_hash, "tx_obs_hash_999");
    assert.strictEqual(finalizedCase?.attestation_tx_hash, "tx_attest_hash_999");
    assert.strictEqual(finalizedCase?.finalization_tx_hash, "tx_final_hash_999");
    assert.strictEqual(Number(finalizedCase?.finalized_at_ledger), 1013);
    assert.strictEqual(indexer.cursor.ledger, 1013);
  });

  it("safely handles duplicate replay without duplicating rows or failing", async () => {
    const dbClient = createDatabaseClient({
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/stellarclear_test",
      network: "testnet",
    });

    const indexer = new IndexerService(dbClient, {
      network: "testnet",
      contractId: VALID_CONTRACT_ID,
    });
    await indexer.init();

    const duplicateEvent: RawStellarEvent = {
      type: "contract",
      ledger: 1005,
      contractId: VALID_CONTRACT_ID,
      id: "0000001005-0000000001",
      topic: ["ObserverAdded", VALID_OBSERVER],
      value: {},
    };

    // First ingestion
    const res1 = await indexer.ingestBatch([duplicateEvent]);
    assert.strictEqual(res1.ingestedCount, 1);

    // Replay duplicate event
    const res2 = await indexer.ingestBatch([duplicateEvent]);
    assert.strictEqual(res2.ingestedCount, 1);
    assert.strictEqual(res2.errors.length, 0);
  });

  it("recovers cursor state on service restart", async () => {
    const dbClient = createDatabaseClient({
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/stellarclear_test",
      network: "testnet",
    });

    const cursorRepo = new CursorRepository(dbClient);
    await cursorRepo.updateCursor("testnet", 9999, "cursor-9999");

    const newIndexerInstance = new IndexerService(dbClient, {
      network: "testnet",
      contractId: VALID_CONTRACT_ID,
    });

    await newIndexerInstance.init();
    assert.strictEqual(newIndexerInstance.cursor.ledger, 9999);
    assert.strictEqual(newIndexerInstance.cursor.eventCursor, "cursor-9999");
  });

  it("does not advance cursor beyond a failed event and retries failed event upon restart (TASK F)", async () => {
    const dbClient = createDatabaseClient({
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/stellarclear_test",
      network: "testnet",
    });
    const cursorRepo = new CursorRepository(dbClient);
    const caseRepo = new CaseRepository(dbClient);

    const indexer = new IndexerService(dbClient, {
      network: "testnet",
      contractId: VALID_CONTRACT_ID,
    });
    await indexer.init();

    // Event 1: Valid CaseCreated
    const event1: RawStellarEvent = {
      type: "contract",
      ledger: 2001,
      contractId: VALID_CONTRACT_ID,
      id: "cursor-001",
      pagingToken: "cursor-001",
      topic: ["CaseCreated", "case-atomicity-001"],
      value: { owner: VALID_OWNER, expires_at_ledger: 2050 },
    };

    // Mock processor to throw a database/processing failure on case-atomicity-002
    const originalProcess = (indexer as any).processor.processEvent.bind((indexer as any).processor);
    (indexer as any).processor.processEvent = async (event: any) => {
      if (event.caseId === "case-atomicity-002") {
        throw new Error("Simulated database write failure for event 2");
      }
      return originalProcess(event);
    };

    // Event 2: Valid format, but processor will fail during persistence
    const event2Failing: RawStellarEvent = {
      type: "contract",
      ledger: 2002,
      contractId: VALID_CONTRACT_ID,
      id: "cursor-002",
      pagingToken: "cursor-002",
      topic: ["CaseCreated", "case-atomicity-002"],
      value: { owner: VALID_OWNER, expires_at_ledger: 2050 },
    };

    // Event 3: Valid CaseCreated that should NOT be skipped over
    const event3: RawStellarEvent = {
      type: "contract",
      ledger: 2003,
      contractId: VALID_CONTRACT_ID,
      id: "cursor-003",
      pagingToken: "cursor-003",
      topic: ["CaseCreated", "case-atomicity-003"],
      value: { owner: VALID_OWNER, expires_at_ledger: 2050 },
    };

    // Ingest the batch containing [event1, event2Failing, event3]
    const result = await indexer.ingestBatch([event1, event2Failing, event3]);

    // 1. Only event 1 should have been ingested
    assert.strictEqual(result.ingestedCount, 1);
    assert.strictEqual(result.errors.length, 1);

    // 2. Cursor must NOT advance to event 2 or event 3
    assert.strictEqual(indexer.cursor.ledger, 2001);
    assert.strictEqual(indexer.cursor.eventCursor, "cursor-001");

    // 3. Durable cursor in DB must be at event 1
    const durableCursor = await cursorRepo.getCursor("testnet");
    assert.strictEqual(durableCursor?.last_processed_ledger, 2001);
    assert.strictEqual(durableCursor?.last_processed_event_cursor, "cursor-001");

    // 4. Case 3 must NOT exist in DB because event 3 was not processed
    const case3 = await caseRepo.findById("case-atomicity-003", "testnet");
    assert.strictEqual(case3, null);

    // 5. Simulate indexer restart: new instance must resume from cursor-001 (retrying event 2)
    const restartedIndexer = new IndexerService(dbClient, {
      network: "testnet",
      contractId: VALID_CONTRACT_ID,
    });
    await restartedIndexer.init();
    assert.strictEqual(restartedIndexer.cursor.ledger, 2001);
    assert.strictEqual(restartedIndexer.cursor.eventCursor, "cursor-001");

    // 6. Now event 2 is fixed / replayed successfully along with event 3
    const event2Fixed: RawStellarEvent = {
      type: "contract",
      ledger: 2002,
      contractId: VALID_CONTRACT_ID,
      id: "cursor-002",
      pagingToken: "cursor-002",
      topic: ["CaseCreated", "case-atomicity-002"],
      value: { owner: VALID_OWNER, expires_at_ledger: 2050 },
    };

    const retryResult = await restartedIndexer.ingestBatch([event2Fixed, event3]);
    assert.strictEqual(retryResult.ingestedCount, 2);
    assert.strictEqual(retryResult.errors.length, 0);

    // 7. Cursor now advances cleanly to event 3
    assert.strictEqual(restartedIndexer.cursor.ledger, 2003);
    assert.strictEqual(restartedIndexer.cursor.eventCursor, "cursor-003");

    const finalDurableCursor = await cursorRepo.getCursor("testnet");
    assert.strictEqual(finalDurableCursor?.last_processed_ledger, 2003);
    assert.strictEqual(finalDurableCursor?.last_processed_event_cursor, "cursor-003");
  });
});
