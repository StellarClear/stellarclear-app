import crypto from "node:crypto";
import { z } from "zod";

function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const RegisterWebhookRequestSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8),
  events: z.array(z.string()).min(1),
  description: z.string().optional(),
});

export type RegisterWebhookRequest = z.infer<typeof RegisterWebhookRequestSchema>;

export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: string[];
  description?: string;
  createdAt: string;
  active: boolean;
}

export interface WebhookPayload {
  id: string;
  event: string;
  timestamp: string;
  caseId: string;
  state: string;
  data: Record<string, unknown>;
}

export interface WebhookDeliveryRecord {
  id: string;
  webhookId: string;
  url: string;
  event: string;
  payload: WebhookPayload;
  attempts: number;
  success: boolean;
  statusCode?: number;
  error?: string;
  timestamp: string;
}

export interface WebhookDispatcherOptions {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  maxRetries?: number;
  initialBackoffMs?: number;
}

/**
 * Computes an HMAC-SHA256 signature for a webhook payload string.
 */
export function computeWebhookSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Validates whether a provided HMAC-SHA256 signature matches the expected signature.
 */
export function verifyWebhookSignature(payload: string, secret: string, signature: string): boolean {
  try {
    const expected = computeWebhookSignature(payload, secret);
    const expectedBuf = Buffer.from(expected, "hex");
    const sigBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== sigBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

/**
 * WebhookDispatcher manages webhook subscriptions and dispatches signed HTTP notifications
 * asynchronously upon settlement case lifecycle transitions with exponential backoff.
 */
export class WebhookDispatcher {
  private readonly subscriptions = new Map<string, WebhookSubscription>();
  private readonly deliveryLogs: WebhookDeliveryRecord[] = [];
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;

  constructor(options?: WebhookDispatcherOptions) {
    this.fetchFn = options?.fetchFn ?? (typeof fetch !== "undefined" ? fetch : async () => new Response());
    this.maxRetries = options?.maxRetries ?? 3;
    this.initialBackoffMs = options?.initialBackoffMs ?? 50;
  }

  /**
   * Registers a new webhook subscription.
   */
  public register(input: RegisterWebhookRequest): WebhookSubscription {
    const validated = RegisterWebhookRequestSchema.parse(input);
    const id = generateUuid();
    const subscription: WebhookSubscription = {
      id,
      url: validated.url,
      secret: validated.secret,
      events: validated.events.map((e) => e.trim().toLowerCase()),
      description: validated.description,
      createdAt: new Date().toISOString(),
      active: true,
    };
    this.subscriptions.set(id, subscription);
    return subscription;
  }

  /**
   * Lists all registered webhook subscriptions.
   */
  public list(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Retrieves a webhook subscription by ID.
   */
  public get(id: string): WebhookSubscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * Deletes a registered webhook by ID.
   */
  public delete(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  /**
   * Clears all subscriptions and delivery logs.
   */
  public clear(): void {
    this.subscriptions.clear();
    this.deliveryLogs.length = 0;
  }

  /**
   * Returns immutable audit log of attempted deliveries.
   */
  public getDeliveryLogs(): WebhookDeliveryRecord[] {
    return [...this.deliveryLogs];
  }

  /**
   * Dispatches an event payload asynchronously to all matching active subscribers.
   */
  public async dispatch(
    event: string,
    caseId: string,
    state: string,
    data: Record<string, unknown>
  ): Promise<WebhookDeliveryRecord[]> {
    const normalizedEvent = event.trim().toLowerCase();
    const matchingSubscriptions: WebhookSubscription[] = [];

    for (const sub of this.subscriptions.values()) {
      if (!sub.active) continue;
      if (sub.events.includes("*") || sub.events.includes(normalizedEvent)) {
        matchingSubscriptions.push(sub);
      }
    }

    if (matchingSubscriptions.length === 0) {
      return [];
    }

    const payload: WebhookPayload = {
      id: generateUuid(),
      event: normalizedEvent,
      timestamp: new Date().toISOString(),
      caseId,
      state,
      data,
    };

    const deliveryPromises = matchingSubscriptions.map((sub) =>
      this.deliverWithRetry(sub, payload)
    );

    return Promise.all(deliveryPromises);
  }

  /**
   * Delivers webhook payload with exponential backoff on transient failures.
   */
  private async deliverWithRetry(
    sub: WebhookSubscription,
    payload: WebhookPayload
  ): Promise<WebhookDeliveryRecord> {
    const payloadStr = JSON.stringify(payload);
    const signature = computeWebhookSignature(payloadStr, sub.secret);
    const deliveryId = generateUuid();

    let attempts = 0;
    let lastError: string | undefined;
    let lastStatusCode: number | undefined;
    let success = false;

    while (attempts < this.maxRetries) {
      attempts++;
      try {
        const response = await this.fetchFn(sub.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stellarclear-signature": signature,
            "x-stellarclear-event": payload.event,
            "x-stellarclear-delivery": deliveryId,
            "x-stellarclear-timestamp": payload.timestamp,
          },
          body: payloadStr,
        });

        lastStatusCode = response.status;
        if (response.ok) {
          success = true;
          break;
        } else {
          lastError = `HTTP ${response.status}: ${response.statusText || "Delivery failed"}`;
        }
      } catch (err: unknown) {
        lastError = (err as Error).message || "Network delivery error";
      }

      // If attempts remaining, apply exponential backoff
      if (attempts < this.maxRetries) {
        const delay = this.initialBackoffMs * Math.pow(2, attempts - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const record: WebhookDeliveryRecord = {
      id: deliveryId,
      webhookId: sub.id,
      url: sub.url,
      event: payload.event,
      payload,
      attempts,
      success,
      statusCode: lastStatusCode,
      error: success ? undefined : lastError,
      timestamp: new Date().toISOString(),
    };

    this.deliveryLogs.push(record);
    return record;
  }
}
