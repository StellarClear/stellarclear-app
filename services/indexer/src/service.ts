import type { IDatabaseClient } from "@stellarclear/db";
import { CursorRepository, ContractEventRepository } from "@stellarclear/db";
import { decodeContractEvent, type RawStellarEvent } from "./decoder.js";
import { EventProcessor } from "./processor.js";
import type { DecodedContractEvent } from "./types.js";
import {
  SettlementEventStream,
  createDurableReplay,
  toStreamEvent,
  type DurableReplay,
} from "./stream.js";

export interface IndexerConfig {
  network: string;
  contractId: string;
  batchSize?: number;
  /** Bounded in-memory replay buffer size for the realtime stream (default 1000). */
  streamBufferSize?: number;
}

export class IndexerService {
  private cursorRepo: CursorRepository;
  private eventRepo: ContractEventRepository;
  private processor: EventProcessor;
  private currentLedger = 0;
  private currentCursor: string | null = null;
  private running = false;
  /** Ordered realtime stream of events that passed decoding and were durably processed. */
  public readonly stream: SettlementEventStream;
  /** Database-backed durable replay used by stream consumers resuming from an event cursor. */
  public readonly durableReplay: DurableReplay;

  constructor(
    private client: IDatabaseClient,
    private config: IndexerConfig
  ) {
    this.cursorRepo = new CursorRepository(client);
    this.eventRepo = new ContractEventRepository(client);
    this.durableReplay = createDurableReplay(client, config.network);
    this.stream = new SettlementEventStream({
      bufferSize: config.streamBufferSize,
      replaySource: this.durableReplay.replaySource,
    });
    this.processor = new EventProcessor(client, config.network);
  }

  /**
   * Initializes the service by loading the durable cursor from the database.
   */
  public async init(): Promise<void> {
    const saved = await this.cursorRepo.getCursor(this.config.network);
    if (saved) {
      this.currentLedger = saved.last_processed_ledger;
      this.currentCursor = saved.last_processed_event_cursor ?? null;
    }
    this.stream.resetBaseline(await this.durableReplay.latestSequence());
  }

  public get cursor(): { ledger: number; eventCursor: string | null } {
    return {
      ledger: this.currentLedger,
      eventCursor: this.currentCursor,
    };
  }

  /**
   * Ingests a batch of raw Stellar events idempotently.
   * Advances and commits cursor only upon success.
   */
  public async ingestBatch(rawEvents: RawStellarEvent[]): Promise<{
    ingestedCount: number;
    skippedCount: number;
    errors: string[];
  }> {
    let ingestedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    let latestLedger = this.currentLedger;
    let latestCursor = this.currentCursor;

    for (const raw of rawEvents) {
      try {
        const decoded: DecodedContractEvent | null = decodeContractEvent(raw);
        if (!decoded) {
          skippedCount++;
          continue;
        }

        // Process event inside transaction boundary
        await this.processor.processEvent(decoded);

        // processEvent durably persisted the validated event (idempotent on
        // network+cursor, including its decoded payload). Read back its ingestion
        // sequence and publish it to the realtime stream.
        const row = await this.eventRepo.findByCursor(decoded.cursor, this.config.network);
        if (!row) {
          throw new Error(`Event ${decoded.cursor} was not persisted; refusing to publish`);
        }
        // Duplicate deliveries resolve to the same sequence and are ignored by the stream.
        this.stream.publish(toStreamEvent(this.config.network, Number(row.id), decoded));

        if (decoded.ledger > latestLedger) {
          latestLedger = decoded.ledger;
        }
        latestCursor = decoded.cursor;
        ingestedCount++;
      } catch (err: unknown) {
        errors.push((err as Error).message);
        // CRITICAL INVARIANT: The cursor must not advance beyond the first event
        // that failed to be durably processed. Stop processing this batch immediately
        // so that the cursor stays at the last durably processed event, and restarting
        // the indexer will deterministically retry event N.
        break;
      }
    }

    // Advance cursor only up to the last durably processed event
    if (latestLedger > this.currentLedger || latestCursor !== this.currentCursor) {
      this.currentLedger = latestLedger;
      this.currentCursor = latestCursor;
      await this.cursorRepo.updateCursor(
        this.config.network,
        this.currentLedger,
        this.currentCursor ?? undefined
      );
    }

    return { ingestedCount, skippedCount, errors };
  }
}
