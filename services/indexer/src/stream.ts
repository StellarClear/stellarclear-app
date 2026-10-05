import type { IDatabaseClient, DbContractEvent } from "@stellarclear/db";
import { ContractEventRepository } from "@stellarclear/db";
import type { DecodedContractEvent, SettlementEventType } from "./types.js";

/**
 * A settlement event that has passed normal decoding and was durably processed
 * by the indexer. `sequence` is the strictly increasing ingestion order of the
 * durable contract_events row; `cursor` is the deterministic Soroban event cursor.
 */
export interface StreamEvent {
  sequence: number;
  network: string;
  contractId: string;
  ledger: number;
  cursor: string;
  caseId: string | null;
  type: SettlementEventType;
  txHash: string;
  data: Record<string, unknown>;
}

/** Durable replay source: events with sequence strictly greater than `afterSequence`, ascending. */
export type ReplaySource = (afterSequence: number, limit: number) => Promise<StreamEvent[]>;

export interface EventStreamOptions {
  /** Maximum events held in the in-memory replay buffer (default 1000). */
  bufferSize?: number;
  /**
   * Highest durable sequence known when the stream was created. Events at or
   * below this sequence are NOT in the in-memory buffer and must come from the
   * durable replay source.
   */
  startSequence?: number;
  /** Durable (database-backed) replay source used when the memory buffer cannot cover a request. */
  replaySource?: ReplaySource;
  /** Page size used when reading from the durable replay source (default 500). */
  replayPageSize?: number;
}

export interface SubscribeOptions {
  /** Deliver events with sequence strictly greater than this value before going live. */
  afterSequence?: number;
  /** Only deliver events for this case. */
  caseId?: string;
}

export type ReplayOrigin = "none" | "memory" | "database";

export interface Subscription {
  readonly replayOrigin: ReplayOrigin;
  unsubscribe(): void;
}

export class ReplayUnavailableError extends Error {
  public readonly code = "REPLAY_UNAVAILABLE";
  constructor(afterSequence: number, floor: number) {
    super(
      `Cannot replay after sequence ${afterSequence}: in-memory buffer starts after ${floor} and no durable replay source is configured`
    );
  }
}

interface Subscriber {
  listener: (event: StreamEvent) => void;
  caseId?: string;
  lastDelivered: number;
  replaying: boolean;
  queue: StreamEvent[];
  closed: boolean;
}

/**
 * Ordered, duplicate-free fan-out of processed settlement events.
 *
 * - Ordering: `publish` accepts only strictly increasing sequences; each
 *   subscriber receives events in ascending sequence order.
 * - Duplicates: an event with a sequence that was already published (e.g. the
 *   indexer re-ingests an event after a restart) is ignored, and each
 *   subscriber tracks its last delivered sequence so replay/live overlap never
 *   delivers an event twice.
 * - The in-memory buffer is bounded and is only a convenience for transient
 *   disconnects. Durable replay always comes from the database via `replaySource`.
 */
export class SettlementEventStream {
  private readonly bufferSize: number;
  private readonly pageSize: number;
  private readonly replaySource?: ReplaySource;
  private buffer: StreamEvent[] = [];
  /** Every event with sequence <= bufferFloor is outside the memory buffer. */
  private bufferFloor: number;
  private lastSequence: number;
  private readonly subscribers = new Set<Subscriber>();

  constructor(options: EventStreamOptions = {}) {
    this.bufferSize = Math.max(1, options.bufferSize ?? 1000);
    this.pageSize = Math.max(1, options.replayPageSize ?? 500);
    this.replaySource = options.replaySource;
    this.bufferFloor = options.startSequence ?? 0;
    this.lastSequence = this.bufferFloor;
  }

  public get bufferedCount(): number {
    return this.buffer.length;
  }

  public get latestSequence(): number {
    return this.lastSequence;
  }

  public get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Re-bases the stream onto the durable log at startup. Only valid while no
   * event has been published yet; everything at or below `sequence` is served
   * from the durable replay source, never from memory.
   */
  public resetBaseline(sequence: number): void {
    if (this.buffer.length > 0 || sequence < this.lastSequence) return;
    this.bufferFloor = sequence;
    this.lastSequence = sequence;
  }

  /** Publishes an event. Returns false if it is a duplicate / out-of-order replay of an older event. */
  public publish(event: StreamEvent): boolean {
    if (event.sequence <= this.lastSequence) {
      return false;
    }
    this.lastSequence = event.sequence;
    this.buffer.push(event);
    while (this.buffer.length > this.bufferSize) {
      const evicted = this.buffer.shift()!;
      this.bufferFloor = evicted.sequence;
    }
    for (const sub of this.subscribers) {
      if (sub.closed) continue;
      if (sub.replaying) {
        sub.queue.push(event);
      } else {
        this.deliver(sub, event);
      }
    }
    return true;
  }

  public async subscribe(
    listener: (event: StreamEvent) => void,
    options: SubscribeOptions = {}
  ): Promise<Subscription> {
    const after = options.afterSequence;
    const sub: Subscriber = {
      listener,
      caseId: options.caseId,
      lastDelivered: after ?? this.lastSequence,
      replaying: after !== undefined,
      queue: [],
      closed: false,
    };

    let origin: ReplayOrigin = "none";
    if (after !== undefined) {
      const memoryCovers = after >= this.bufferFloor;
      if (!memoryCovers && !this.replaySource) {
        throw new ReplayUnavailableError(after, this.bufferFloor);
      }
      // Register before replay so concurrent publishes are queued, not lost.
      this.subscribers.add(sub);
      try {
        if (memoryCovers) {
          origin = "memory";
          for (const ev of this.buffer) {
            if (ev.sequence > sub.lastDelivered) this.deliver(sub, ev);
          }
        } else {
          origin = "database";
          await this.replayFromSource(sub);
        }
      } catch (err) {
        this.subscribers.delete(sub);
        throw err;
      }
      // Drain events published during replay and go live in the same tick (no await).
      for (const ev of sub.queue) {
        if (ev.sequence > sub.lastDelivered) this.deliver(sub, ev);
      }
      sub.queue = [];
      sub.replaying = false;
    } else {
      this.subscribers.add(sub);
    }

    return {
      replayOrigin: origin,
      unsubscribe: () => {
        sub.closed = true;
        this.subscribers.delete(sub);
      },
    };
  }

  private async replayFromSource(sub: Subscriber): Promise<void> {
    for (;;) {
      if (sub.closed) return;
      const page = await this.replaySource!(sub.lastDelivered, this.pageSize);
      for (const ev of page) {
        if (ev.sequence > sub.lastDelivered) this.deliver(sub, ev);
      }
      if (page.length < this.pageSize) return;
    }
  }

  private deliver(sub: Subscriber, event: StreamEvent): void {
    if (sub.closed) return;
    // Advance the cursor even for filtered events so we never re-evaluate them.
    sub.lastDelivered = event.sequence;
    if (sub.caseId && event.caseId !== sub.caseId) return;
    try {
      sub.listener(event);
    } catch {
      sub.closed = true;
      this.subscribers.delete(sub);
    }
  }
}

/** Converts a decoded indexer event plus its durable row id into a stream event. */
export function toStreamEvent(
  network: string,
  sequence: number,
  decoded: DecodedContractEvent
): StreamEvent {
  return {
    sequence,
    network,
    contractId: decoded.contractId,
    ledger: decoded.ledger,
    cursor: decoded.cursor,
    caseId: decoded.caseId ?? null,
    type: decoded.type,
    txHash: decoded.txHash,
    data: decoded.payload,
  };
}

function rowToStreamEvent(row: DbContractEvent): StreamEvent {
  return {
    sequence: Number(row.id),
    network: row.network,
    contractId: row.contract_id,
    ledger: Number(row.ledger),
    cursor: row.cursor,
    caseId: row.case_id ?? null,
    type: row.event_type as SettlementEventType,
    txHash: row.tx_hash,
    data: (typeof row.payload === "string"
      ? (JSON.parse(row.payload) as Record<string, unknown>)
      : row.payload) ?? {},
  };
}

export interface DurableReplay {
  replaySource: ReplaySource;
  /** Resolves a client-held deterministic event cursor to its durable sequence, or null if unknown. */
  resolveCursor: (cursor: string) => Promise<number | null>;
  /** Highest durable sequence currently persisted. */
  latestSequence: () => Promise<number>;
}

/** Database-backed durable replay built on the contract_events table. */
export function createDurableReplay(client: IDatabaseClient, network: string): DurableReplay {
  const repo = new ContractEventRepository(client);
  return {
    replaySource: async (afterSequence, limit) =>
      (await repo.listAfterId(network, afterSequence, limit)).map(rowToStreamEvent),
    resolveCursor: async (cursor) => {
      const row = await repo.findByCursor(cursor, network);
      return row ? Number(row.id) : null;
    },
    latestSequence: () => repo.maxId(network),
  };
}
