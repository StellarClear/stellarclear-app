import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import {
  IndexerService,
  SettlementEventStream,
  ReplayUnavailableError,
  startEventStreamServer,
  type RawStellarEvent,
  type StreamEvent,
  type EventStreamServer,
} from "@stellarclear/indexer";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const NETWORK = "testnet";
const OWNER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ";

function caseIdFor(n: number): string {
  return n.toString(16).padStart(2, "0").repeat(32);
}

function rawCaseCreated(n: number): RawStellarEvent {
  return {
    type: "contract",
    ledger: 1000 + n,
    contractId: CONTRACT_ID,
    id: `cursor-${String(n).padStart(4, "0")}`,
    txHash: n.toString(16).padStart(2, "0").repeat(32),
    topic: ["CaseCreated", caseIdFor(n)],
    value: { owner: OWNER, counterparty: null, expires_at_ledger: 5000 + n },
  };
}

function makeEvent(sequence: number, caseId: string | null = null): StreamEvent {
  return {
    sequence,
    network: NETWORK,
    contractId: CONTRACT_ID,
    ledger: 100 + sequence,
    cursor: `c-${sequence}`,
    caseId,
    type: "CaseCreated",
    txHash: "0".repeat(64),
    data: { n: sequence },
  };
}

interface WsClient {
  ws: WebSocket;
  messages: Array<Record<string, any>>;
  events: () => Array<Record<string, any>>;
  waitFor: (predicate: () => boolean, timeoutMs?: number) => Promise<void>;
  close: () => Promise<void>;
}

async function connect(port: number, query = ""): Promise<WsClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/events/ws${query}`);
  const messages: Array<Record<string, any>> = [];
  const listeners: Array<() => void> = [];
  ws.onmessage = (e: MessageEvent) => {
    messages.push(JSON.parse(String(e.data)));
    for (const l of [...listeners]) l();
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("websocket connection failed"));
  });
  const waitFor = (predicate: () => boolean, timeoutMs = 3000): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (predicate()) return resolve();
      const timer = setTimeout(() => reject(new Error("timed out waiting for condition")), timeoutMs);
      const check = (): void => {
        if (predicate()) {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(check), 1);
          resolve();
        }
      };
      listeners.push(check);
    });
  return {
    ws,
    messages,
    events: () => messages.filter((m) => m["type"] === "event"),
    waitFor,
    close: async () => {
      const closed = new Promise<void>((resolve) => {
        ws.onclose = () => resolve();
      });
      ws.close();
      await closed;
    },
  };
}

async function setup(streamBufferSize?: number): Promise<{
  service: IndexerService;
  server: EventStreamServer;
}> {
  const db = new InMemoryDatabaseClient();
  const service = new IndexerService(db, {
    network: NETWORK,
    contractId: CONTRACT_ID,
    streamBufferSize,
  });
  await service.init();
  const server = await startEventStreamServer({
    stream: service.stream,
    durable: service.durableReplay,
    network: NETWORK,
    contractId: CONTRACT_ID,
    heartbeatMs: 60_000,
  });
  return { service, server };
}

describe("Indexer Realtime Stream - ordering and duplicate protection (hub)", () => {
  it("delivers events to subscribers in strictly ascending order", async () => {
    const stream = new SettlementEventStream();
    const received: number[] = [];
    await stream.subscribe((e) => received.push(e.sequence));
    for (let i = 1; i <= 5; i++) stream.publish(makeEvent(i));
    assert.deepStrictEqual(received, [1, 2, 3, 4, 5]);
  });

  it("ignores duplicate and out-of-order older publishes", async () => {
    const stream = new SettlementEventStream();
    const received: number[] = [];
    await stream.subscribe((e) => received.push(e.sequence));
    assert.strictEqual(stream.publish(makeEvent(1)), true);
    assert.strictEqual(stream.publish(makeEvent(2)), true);
    assert.strictEqual(stream.publish(makeEvent(2)), false);
    assert.strictEqual(stream.publish(makeEvent(1)), false);
    assert.strictEqual(stream.publish(makeEvent(3)), true);
    assert.deepStrictEqual(received, [1, 2, 3]);
  });

  it("keeps the replay buffer bounded and refuses memory-only replay it cannot cover", async () => {
    const stream = new SettlementEventStream({ bufferSize: 3 });
    for (let i = 1; i <= 10; i++) stream.publish(makeEvent(i));
    assert.strictEqual(stream.bufferedCount, 3);

    await assert.rejects(
      () => stream.subscribe(() => undefined, { afterSequence: 2 }),
      (err: unknown) => err instanceof ReplayUnavailableError
    );

    const received: number[] = [];
    const sub = await stream.subscribe((e) => received.push(e.sequence), { afterSequence: 7 });
    assert.strictEqual(sub.replayOrigin, "memory");
    assert.deepStrictEqual(received, [8, 9, 10]);
  });

  it("replays from the durable source when memory cannot cover, without duplicating live events", async () => {
    const all: StreamEvent[] = [];
    for (let i = 1; i <= 10; i++) all.push(makeEvent(i));
    const stream = new SettlementEventStream({
      bufferSize: 2,
      replayPageSize: 3,
      replaySource: async (after, limit) => all.filter((e) => e.sequence > after).slice(0, limit),
    });
    for (const e of all) stream.publish(e);

    const received: number[] = [];
    const sub = await stream.subscribe((e) => received.push(e.sequence), { afterSequence: 1 });
    assert.strictEqual(sub.replayOrigin, "database");
    stream.publish(makeEvent(11));
    assert.deepStrictEqual(received, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("Indexer Realtime Stream - end to end over WebSocket", () => {
  it("streams processed events in order with full correlation metadata", async () => {
    const { service, server } = await setup();
    const client = await connect(server.port);
    try {
      await client.waitFor(() => client.messages.some((m) => m["type"] === "live"));

      await service.ingestBatch([rawCaseCreated(1), rawCaseCreated(2), rawCaseCreated(3)]);
      await client.waitFor(() => client.events().length === 3);

      const events = client.events();
      assert.deepStrictEqual(
        events.map((e) => e["cursor"]),
        ["cursor-0001", "cursor-0002", "cursor-0003"]
      );
      const seqs = events.map((e) => e["sequence"] as number);
      assert.ok(seqs[0] < seqs[1] && seqs[1] < seqs[2]);

      const first = events[0];
      assert.strictEqual(first["network"], NETWORK);
      assert.strictEqual(first["contractId"], CONTRACT_ID);
      assert.strictEqual(first["ledger"], 1001);
      assert.strictEqual(first["caseId"], caseIdFor(1));
      assert.strictEqual(first["eventType"], "CaseCreated");
      assert.strictEqual(first["data"]["owner"], OWNER);
      assert.strictEqual(first["data"]["expiresAtLedger"], 5001);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("does not publish events that fail decoding", async () => {
    const { service, server } = await setup();
    const client = await connect(server.port);
    try {
      await client.waitFor(() => client.messages.some((m) => m["type"] === "live"));
      const unknown: RawStellarEvent = {
        type: "contract",
        ledger: 2000,
        contractId: CONTRACT_ID,
        id: "cursor-unknown",
        topic: ["NotASettlementEvent"],
      };
      await service.ingestBatch([unknown, rawCaseCreated(4)]);
      await client.waitFor(() => client.events().length === 1);
      assert.strictEqual(client.events()[0]["cursor"], "cursor-0004");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("does not deliver an event twice when the indexer re-ingests it", async () => {
    const { service, server } = await setup();
    const client = await connect(server.port);
    try {
      await client.waitFor(() => client.messages.some((m) => m["type"] === "live"));
      await service.ingestBatch([rawCaseCreated(1), rawCaseCreated(2)]);
      // Same raw events re-delivered (e.g. RPC overlap after restart)
      await service.ingestBatch([rawCaseCreated(1), rawCaseCreated(2), rawCaseCreated(3)]);
      await client.waitFor(() => client.events().length === 3);
      await new Promise((r) => setTimeout(r, 100));
      assert.deepStrictEqual(
        client.events().map((e) => e["cursor"]),
        ["cursor-0001", "cursor-0002", "cursor-0003"]
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("resumes after disconnect from the memory buffer using the last event cursor, with no gaps or duplicates", async () => {
    const { service, server } = await setup();
    const first = await connect(server.port);
    try {
      await first.waitFor(() => first.messages.some((m) => m["type"] === "live"));
      await service.ingestBatch([rawCaseCreated(1), rawCaseCreated(2)]);
      await first.waitFor(() => first.events().length === 2);
      const lastCursor = first.events()[1]["cursor"] as string;
      await first.close();

      // Events produced while the client is disconnected
      await service.ingestBatch([rawCaseCreated(3), rawCaseCreated(4), rawCaseCreated(5)]);

      const second = await connect(server.port, `?afterCursor=${lastCursor}`);
      try {
        await second.waitFor(() => second.events().length === 3);
        await second.waitFor(() => second.messages.some((m) => m["type"] === "live"));
        assert.deepStrictEqual(
          second.events().map((e) => e["cursor"]),
          ["cursor-0003", "cursor-0004", "cursor-0005"]
        );
        assert.strictEqual(second.messages.find((m) => m["type"] === "live")!["replayOrigin"], "memory");

        // Live events continue after catch-up, still without duplicates
        await service.ingestBatch([rawCaseCreated(6)]);
        await second.waitFor(() => second.events().length === 4);
        assert.strictEqual(second.events()[3]["cursor"], "cursor-0006");
      } finally {
        await second.close();
      }
    } finally {
      await server.close();
    }
  });

  it("resumes from the database when the bounded memory buffer no longer covers the cursor", async () => {
    const { service, server } = await setup(2);
    try {
      await service.ingestBatch([1, 2, 3, 4, 5, 6].map(rawCaseCreated));

      const client = await connect(server.port, "?afterCursor=cursor-0002");
      try {
        await client.waitFor(() => client.events().length === 4);
        await client.waitFor(() => client.messages.some((m) => m["type"] === "live"));
        assert.deepStrictEqual(
          client.events().map((e) => e["cursor"]),
          ["cursor-0003", "cursor-0004", "cursor-0005", "cursor-0006"]
        );
        assert.strictEqual(client.messages.find((m) => m["type"] === "live")!["replayOrigin"], "database");
        // Replayed events carry the same decoded data as live ones
        assert.strictEqual(client.events()[0]["data"]["owner"], OWNER);
        assert.strictEqual(client.events()[0]["caseId"], caseIdFor(3));
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("rejects resume requests with an unknown cursor instead of guessing", async () => {
    const { service, server } = await setup();
    try {
      await service.ingestBatch([rawCaseCreated(1)]);
      const client = await connect(server.port, "?afterCursor=does-not-exist");
      try {
        await client.waitFor(() => client.messages.some((m) => m["type"] === "error"));
        const err = client.messages.find((m) => m["type"] === "error")!;
        assert.strictEqual(err["code"], "UNKNOWN_CURSOR");
        assert.strictEqual(client.events().length, 0);
      } finally {
        await client.close().catch(() => undefined);
      }
    } finally {
      await server.close();
    }
  });

  it("filters by case ID without disturbing ordering", async () => {
    const { service, server } = await setup();
    const client = await connect(server.port, `?caseId=${caseIdFor(2)}`);
    try {
      await client.waitFor(() => client.messages.some((m) => m["type"] === "live"));
      await service.ingestBatch([rawCaseCreated(1), rawCaseCreated(2), rawCaseCreated(3)]);
      await client.waitFor(() => client.events().length === 1);
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(client.events().length, 1);
      assert.strictEqual(client.events()[0]["cursor"], "cursor-0002");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
