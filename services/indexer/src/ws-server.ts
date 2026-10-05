import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { DurableReplay, StreamEvent, SettlementEventStream, Subscription } from "./stream.js";
import { ReplayUnavailableError } from "./stream.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_CLIENT_FRAME_BYTES = 64 * 1024;

export const EVENT_STREAM_PATH = "/v1/events/ws";

export interface EventStreamServerOptions {
  stream: SettlementEventStream;
  network: string;
  contractId: string;
  /** Database-backed durable replay. Required to resume from an `afterCursor` older than the memory buffer. */
  durable?: DurableReplay;
  port?: number;
  host?: string;
  path?: string;
  /** When set, clients must present `Authorization: Bearer <token>` or `?token=<token>`. */
  authToken?: string;
  heartbeatMs?: number;
  /** Slow consumers whose pending outbound bytes exceed this are disconnected (default 1 MiB). */
  maxBufferedBytes?: number;
}

export interface EventStreamServer {
  port: number;
  close(): Promise<void>;
}

interface WsSocket {
  write(data: Uint8Array): boolean;
  end(data?: Uint8Array): void;
  destroy(): void;
  writableLength?: number;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  let header: number[];
  if (len < 126) {
    header = [0x80 | opcode, len];
  } else if (len < 65536) {
    header = [0x80 | opcode, 126, (len >> 8) & 0xff, len & 0xff];
  } else {
    // Payloads here are far below 2^32 bytes.
    header = [0x80 | opcode, 127, 0, 0, 0, 0, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  }
  const out = new Uint8Array(header.length + len);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

const textEncoder = new TextEncoder();

function textFrame(obj: unknown): Uint8Array {
  return encodeFrame(0x1, textEncoder.encode(JSON.stringify(obj)));
}

function closeFrame(code: number, reason: string): Uint8Array {
  const reasonBytes = textEncoder.encode(reason.slice(0, 100));
  const payload = new Uint8Array(2 + reasonBytes.length);
  payload[0] = (code >> 8) & 0xff;
  payload[1] = code & 0xff;
  payload.set(reasonBytes, 2);
  return encodeFrame(0x8, payload);
}

/** Wire format of an event message. */
export function toWireEvent(event: StreamEvent): Record<string, unknown> {
  return {
    type: "event",
    sequence: event.sequence,
    network: event.network,
    contractId: event.contractId,
    ledger: event.ledger,
    cursor: event.cursor,
    caseId: event.caseId,
    eventType: event.type,
    txHash: event.txHash,
    data: event.data,
  };
}

/**
 * Minimal RFC 6455 server for the settlement event stream, built on node:http
 * so no new dependency is introduced. It only ever sends text frames and
 * understands client control frames (ping/pong/close).
 *
 * Resume protocol: connect with `?afterCursor=<last cursor received>`. The
 * cursor is the deterministic Soroban event cursor; the server resolves it to
 * the durable ingestion sequence and replays everything after it (from the
 * bounded memory buffer when possible, otherwise from the database) before
 * switching to live delivery. Without `afterCursor` the client receives live
 * events only.
 */
export async function startEventStreamServer(
  options: EventStreamServerOptions
): Promise<EventStreamServer> {
  const path = options.path ?? EVENT_STREAM_PATH;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const maxBuffered = options.maxBufferedBytes ?? 1024 * 1024;
  const sockets = new Set<WsSocket>();

  const server = createServer((_req, res) => {
    res.writeHead(426, { "content-type": "text/plain", upgrade: "websocket" });
    res.end("Upgrade Required");
  });

  const rejectUpgrade = (socket: WsSocket, status: string): void => {
    socket.write(textEncoder.encode(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`));
    socket.destroy();
  };

  server.on("upgrade", (req: any, socket: WsSocket) => {
    const url = new URL(String(req.url ?? "/"), "http://localhost");
    if (url.pathname !== path) {
      return rejectUpgrade(socket, "404 Not Found");
    }
    if (options.authToken) {
      const header = String(req.headers["authorization"] ?? "");
      const supplied = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token");
      if (supplied !== options.authToken) {
        return rejectUpgrade(socket, "401 Unauthorized");
      }
    }
    const key = req.headers["sec-websocket-key"];
    if (
      String(req.headers["upgrade"] ?? "").toLowerCase() !== "websocket" ||
      typeof key !== "string" ||
      String(req.headers["sec-websocket-version"] ?? "") !== "13"
    ) {
      return rejectUpgrade(socket, "400 Bad Request");
    }

    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      textEncoder.encode(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      )
    );
    sockets.add(socket);

    let subscription: Subscription | null = null;
    let closed = false;
    let inbound = new Uint8Array(0);

    const shutdown = (code: number, reason: string): void => {
      if (closed) return;
      closed = true;
      subscription?.unsubscribe();
      clearInterval(heartbeat);
      sockets.delete(socket);
      try {
        socket.end(closeFrame(code, reason));
      } catch {
        socket.destroy();
      }
    };

    const send = (frame: Uint8Array): void => {
      if (closed) return;
      socket.write(frame);
      if ((socket.writableLength ?? 0) > maxBuffered) {
        shutdown(1013, "slow consumer");
      }
    };

    const heartbeat = setInterval(() => send(encodeFrame(0x9, new Uint8Array(0))), heartbeatMs);
    (heartbeat as unknown as { unref?: () => void }).unref?.();

    socket.on("close", () => {
      closed = true;
      subscription?.unsubscribe();
      clearInterval(heartbeat);
      sockets.delete(socket);
    });
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: Uint8Array) => {
      const merged = new Uint8Array(inbound.length + chunk.length);
      merged.set(inbound, 0);
      merged.set(chunk, inbound.length);
      inbound = merged;
      // Parse as many complete client frames as are buffered.
      for (;;) {
        if (inbound.length < 2) return;
        const opcode = inbound[0] & 0x0f;
        const masked = (inbound[1] & 0x80) !== 0;
        let len = inbound[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (inbound.length < 4) return;
          len = (inbound[2] << 8) | inbound[3];
          offset = 4;
        } else if (len === 127) {
          shutdown(1009, "frame too large");
          return;
        }
        if (!masked) {
          shutdown(1002, "client frames must be masked");
          return;
        }
        if (len > MAX_CLIENT_FRAME_BYTES) {
          shutdown(1009, "frame too large");
          return;
        }
        if (inbound.length < offset + 4 + len) return;
        const mask = inbound.subarray(offset, offset + 4);
        const payload = new Uint8Array(len);
        for (let i = 0; i < len; i++) payload[i] = inbound[offset + 4 + i] ^ mask[i % 4];
        inbound = inbound.slice(offset + 4 + len);
        if (opcode === 0x8) {
          shutdown(1000, "bye");
          return;
        }
        if (opcode === 0x9) {
          send(encodeFrame(0xa, payload));
        }
        // Text/binary/pong from clients carry no commands in this protocol.
      }
    });

    const afterCursor = url.searchParams.get("afterCursor");
    const caseId = url.searchParams.get("caseId") ?? undefined;

    void (async () => {
      try {
        let afterSequence: number | undefined;
        if (afterCursor) {
          if (!options.durable) {
            send(textFrame({ type: "error", code: "REPLAY_UNAVAILABLE", message: "durable replay not configured" }));
            return shutdown(1008, "replay unavailable");
          }
          const resolved = await options.durable.resolveCursor(afterCursor);
          if (resolved === null) {
            send(textFrame({ type: "error", code: "UNKNOWN_CURSOR", message: `unknown cursor ${afterCursor}` }));
            return shutdown(1008, "unknown cursor");
          }
          afterSequence = resolved;
        }
        send(
          textFrame({
            type: "subscribed",
            network: options.network,
            contractId: options.contractId,
            afterCursor: afterCursor ?? null,
            caseId: caseId ?? null,
          })
        );
        const sub = await options.stream.subscribe((ev) => send(textFrame(toWireEvent(ev))), {
          afterSequence,
          caseId,
        });
        if (closed) {
          sub.unsubscribe();
          return;
        }
        subscription = sub;
        send(textFrame({ type: "live", replayOrigin: sub.replayOrigin }));
      } catch (err) {
        const code = err instanceof ReplayUnavailableError ? err.code : "SUBSCRIBE_FAILED";
        send(textFrame({ type: "error", code, message: (err as Error).message }));
        shutdown(1011, code);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);

  return {
    port,
    close: async () => {
      for (const s of sockets) {
        try {
          s.end(closeFrame(1001, "server shutting down"));
        } catch {
          s.destroy();
        }
        s.destroy();
      }
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
