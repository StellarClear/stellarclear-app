import { createHmac, randomBytes } from "node:crypto";

export type SettlementEventType =
  | "case.created"
  | "case.observed"
  | "case.matched"
  | "case.break"
  | "case.disputed"
  | "case.resolved"
  | "case.finalized"
  | "*";

export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: SettlementEventType[];
  active: boolean;
  createdAt: string;
}

export interface RegisterWebhookRequest {
  url: string;
  secret?: string;
  events?: SettlementEventType[];
}

export interface WebhookPayload<T = unknown> {
  id: string;
  event: SettlementEventType;
  timestamp: string;
  data: T;
}

export interface WebhookDeliveryAttempt {
  id: string;
  webhookId: string;
  url: string;
  event: SettlementEventType;
  status: "success" | "failure";
  statusCode?: number;
  attempts: number;
  error?: string;
  dispatchedAt: string;
}

export interface WebhookDispatcherOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  fetchFn?: typeof fetch;
}

export function signPayload(payloadJson: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadJson).digest("hex");
}

export class WebhookDispatcher {
  private readonly subscriptions: Map<string, WebhookSubscription> = new Map();
  private readonly deliveries: WebhookDeliveryAttempt[] = [];
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options?: WebhookDispatcherOptions) {
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.baseBackoffMs = options?.baseBackoffMs ?? 50;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  public register(input: RegisterWebhookRequest): WebhookSubscription {
    if (!input || !input.url || typeof input.url !== "string") {
      throw new Error("Invalid webhook URL: must be a non-empty string");
    }

    try {
      const parsed = new URL(input.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Webhook URL must use http or https protocol");
      }
    } catch {
      throw new Error("Invalid webhook URL format");
    }

    const secret =
      input.secret && typeof input.secret === "string" && input.secret.trim().length >= 8
        ? input.secret.trim()
        : randomBytes(16).toString("hex");

    const validEvents: SettlementEventType[] = [
      "case.created",
      "case.observed",
      "case.matched",
      "case.break",
      "case.disputed",
      "case.resolved",
      "case.finalized",
      "*",
    ];

    let events: SettlementEventType[] = ["*"];
    if (Array.isArray(input.events) && input.events.length > 0) {
      events = input.events.filter((ev) => validEvents.includes(ev));
      if (events.length === 0) {
        events = ["*"];
      }
    }

    const subscription: WebhookSubscription = {
      id: "wh_" + randomBytes(8).toString("hex"),
      url: input.url.trim(),
      secret,
      events,
      active: true,
      createdAt: new Date().toISOString(),
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  public list(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  public get(id: string): WebhookSubscription | undefined {
    return this.subscriptions.get(id);
  }

  public delete(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  public getDeliveries(): WebhookDeliveryAttempt[] {
    return [...this.deliveries];
  }

  public clear(): void {
    this.subscriptions.clear();
    this.deliveries.length = 0;
  }

  /**
   * Dispatches a webhook notification payload to all matching subscribers
   * with HMAC-SHA256 signature and exponential backoff retry on failure.
   */
  public async dispatch<T>(event: SettlementEventType, data: T): Promise<void> {
    const matching = Array.from(this.subscriptions.values()).filter(
      (sub) => sub.active && (sub.events.includes("*") || sub.events.includes(event))
    );

    if (matching.length === 0) return;

    const payload: WebhookPayload<T> = {
      id: "evt_" + randomBytes(8).toString("hex"),
      event,
      timestamp: new Date().toISOString(),
      data,
    };
    const bodyString = JSON.stringify(payload);

    await Promise.all(
      matching.map(async (sub) => {
        const signature = signPayload(bodyString, sub.secret);
        let attempt = 0;
        let lastError: string | undefined;
        let success = false;
        let lastStatusCode: number | undefined;

        while (attempt < this.maxAttempts && !success) {
          attempt++;
          try {
            const res = await this.fetchFn(sub.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-stellarclear-signature": signature,
                "x-stellarclear-event": event,
                "x-stellarclear-delivery": payload.id,
              },
              body: bodyString,
              signal: AbortSignal.timeout(5000),
            });
            lastStatusCode = res.status;
            if (res.ok) {
              success = true;
            } else {
              lastError = `HTTP ${res.status} ${res.statusText}`;
            }
          } catch (err: unknown) {
            lastError = (err as Error).message || "Network delivery failed";
          }

          if (!success && attempt < this.maxAttempts) {
            const delay = this.baseBackoffMs * Math.pow(2, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        this.deliveries.push({
          id: "del_" + randomBytes(8).toString("hex"),
          webhookId: sub.id,
          url: sub.url,
          event,
          status: success ? "success" : "failure",
          statusCode: lastStatusCode,
          attempts: attempt,
          error: success ? undefined : lastError,
          dispatchedAt: new Date().toISOString(),
        });
      })
    );
  }
}
