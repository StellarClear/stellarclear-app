import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDatabaseClient } from "@stellarclear/db";
import {
  createApiServer,
  WebhookDispatcher,
  computeWebhookSignature,
  verifyWebhookSignature,
  type WebhookPayload,
} from "@stellarclear/api";
import type { ExpectedSettlement, ObservedSettlement } from "@stellarclear/schemas";

const VALID_CASE_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_TX_HASH = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const VALID_OWNER = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEWBIXXX";
const VALID_DESTINATION = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const SAMPLE_EXPECTED: ExpectedSettlement = {
  caseId: VALID_CASE_ID,
  tradeReference: "TR-WEBHOOK-101",
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  amount: "500.0000000",
  expectedDestination: VALID_DESTINATION,
  reference: "INV-WH-101",
  deadline: 600000,
  owner: VALID_OWNER,
  counterparty: VALID_DESTINATION,
};

const SAMPLE_OBSERVED: ObservedSettlement = {
  txHash: VALID_TX_HASH,
  ledger: 599990,
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  amount: "500.0000000",
  destination: VALID_DESTINATION,
  reference: "INV-WH-101",
  status: "SUCCESS",
  observedAt: "2026-09-29T12:00:00.000Z",
};

describe("API Service - Webhook Subscription Endpoints & Dispatcher", () => {
  const dbClient = createDatabaseClient({
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/stellarclear_test",
    network: "testnet",
  });

  const capturedRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];

  // Mock fetch function to capture outgoing webhook HTTP requests
  const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    capturedRequests.push({
      url,
      headers: (init?.headers as Record<string, string>) || {},
      body: (init?.body as string) || "",
    });
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  };

  const customDispatcher = new WebhookDispatcher({
    fetchFn: mockFetch,
    maxRetries: 3,
    initialBackoffMs: 10,
  });

  const server = createApiServer(
    {
      port: 3000,
      host: "0.0.0.0",
      network: "testnet",
      databaseUrl: "postgresql://localhost",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    },
    dbClient,
    undefined,
    undefined,
    customDispatcher
  );

  it("POST /v1/webhooks registers a valid webhook subscription", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "https://fintech.example.com/webhooks/stellarclear",
        secret: "super-secret-key-12345",
        events: ["case.opened", "case.observed", "case.matched"],
        description: "Fintech Settlement Webhook",
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = res.body as { webhook: { id: string; url: string; secret: string; events: string[] } };
    assert.ok(body.webhook.id);
    assert.strictEqual(body.webhook.url, "https://fintech.example.com/webhooks/stellarclear");
    assert.strictEqual(body.webhook.secret, "super-secret-key-12345");
    assert.deepStrictEqual(body.webhook.events, ["case.opened", "case.observed", "case.matched"]);
  });

  it("POST /v1/webhooks rejects invalid URLs or short secrets with 400", async () => {
    const resInvalidUrl = await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "not-a-valid-url",
        secret: "super-secret-key-12345",
        events: ["case.opened"],
      },
    });
    assert.strictEqual(resInvalidUrl.statusCode, 400);

    const resShortSecret = await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "https://fintech.example.com/webhooks",
        secret: "short",
        events: ["case.opened"],
      },
    });
    assert.strictEqual(resShortSecret.statusCode, 400);
  });

  it("GET /v1/webhooks lists all registered subscriptions", async () => {
    const res = await server.inject({ method: "GET", url: "/v1/webhooks" });
    assert.strictEqual(res.statusCode, 200);
    const body = res.body as { webhooks: Array<{ id: string; url: string }> };
    assert.ok(Array.isArray(body.webhooks));
    assert.ok(body.webhooks.length >= 1);
  });

  it("DELETE /v1/webhooks/:id removes subscription and handles 404", async () => {
    // Register temporary webhook
    const regRes = await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "https://temp.example.com/hook",
        secret: "temp-secret-99999",
        events: ["*"],
      },
    });
    const subId = (regRes.body as any).webhook.id;

    const delRes = await server.inject({ method: "DELETE", url: `/v1/webhooks/${subId}` });
    assert.strictEqual(delRes.statusCode, 200);
    assert.strictEqual((delRes.body as any).deleted, true);

    // Second delete returns 404
    const delRes404 = await server.inject({ method: "DELETE", url: `/v1/webhooks/${subId}` });
    assert.strictEqual(delRes404.statusCode, 404);
  });

  it("HMAC-SHA256 signature verification helper verifies authentic signatures and rejects tampering", () => {
    const secret = "shared-subscriber-secret";
    const payload = JSON.stringify({ event: "case.matched", caseId: VALID_CASE_ID });

    const signature = computeWebhookSignature(payload, secret);
    assert.ok(signature.length === 64);

    assert.strictEqual(verifyWebhookSignature(payload, secret, signature), true);
    assert.strictEqual(verifyWebhookSignature(payload + "tampered", secret, signature), false);
    assert.strictEqual(verifyWebhookSignature(payload, "wrong-secret", signature), false);
    assert.strictEqual(verifyWebhookSignature(payload, secret, "invalid-sig-hex"), false);
  });

  it("dispatches webhook events across settlement case lifecycle transitions", async () => {
    capturedRequests.length = 0;

    // 1. Create Case -> dispatches case.opened
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: SAMPLE_EXPECTED },
    });
    assert.strictEqual(createRes.statusCode, 201);

    // Wait a tick for async dispatch
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(capturedRequests.length >= 1);
    const openedReq = capturedRequests[capturedRequests.length - 1];
    assert.strictEqual(openedReq.headers["x-stellarclear-event"], "case.opened");
    assert.ok(openedReq.headers["x-stellarclear-signature"]);
    const openedPayload: WebhookPayload = JSON.parse(openedReq.body);
    assert.strictEqual(openedPayload.event, "case.opened");
    assert.strictEqual(openedPayload.caseId, VALID_CASE_ID);
    assert.strictEqual(openedPayload.state, "OPEN");

    // 2. Observe Case -> dispatches case.observed
    const obsRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${VALID_CASE_ID}/observe`,
      body: { observation: SAMPLE_OBSERVED },
    });
    assert.strictEqual(obsRes.statusCode, 200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const obsReq = capturedRequests[capturedRequests.length - 1];
    assert.strictEqual(obsReq.headers["x-stellarclear-event"], "case.observed");
    const obsPayload: WebhookPayload = JSON.parse(obsReq.body);
    assert.strictEqual(obsPayload.event, "case.observed");
    assert.strictEqual(obsPayload.state, "OBSERVED");

    // 3. Reconcile Case -> dispatches case.matched
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${VALID_CASE_ID}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const recReq = capturedRequests[capturedRequests.length - 1];
    assert.strictEqual(recReq.headers["x-stellarclear-event"], "case.matched");
    const recPayload: WebhookPayload = JSON.parse(recReq.body);
    assert.strictEqual(recPayload.event, "case.matched");
    assert.strictEqual(recPayload.state, "MATCHED");
  });

  it("handles delivery retry with exponential backoff on transient network failures", async () => {
    let attemptCount = 0;
    const failingFetch = async (): Promise<Response> => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error("Temporary network glitch");
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const retryDispatcher = new WebhookDispatcher({
      fetchFn: failingFetch,
      maxRetries: 3,
      initialBackoffMs: 10,
    });

    retryDispatcher.register({
      url: "https://reliable-service.example.com/webhook",
      secret: "retry-secret-key-12345",
      events: ["case.disputed"],
    });

    const records = await retryDispatcher.dispatch("case.disputed", VALID_CASE_ID, "DISPUTED", { reason: "Amount break" });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].success, true);
    assert.strictEqual(records[0].attempts, 3);
  });
});
