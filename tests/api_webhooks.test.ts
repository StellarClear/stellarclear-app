import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createDatabaseClient } from "@stellarclear/db";
import { createApiServer, WebhookDispatcher } from "@stellarclear/api";
import type { ExpectedSettlement } from "@stellarclear/schemas";

const VALID_CASE_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_OWNER = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEWBIXXX";
const VALID_DESTINATION = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const SAMPLE_EXPECTED: ExpectedSettlement = {
  caseId: VALID_CASE_ID,
  tradeReference: "TR-WEBHOOK-1",
  asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  amount: "100.0000000",
  expectedDestination: VALID_DESTINATION,
  reference: "INV-WEBHOOK-1",
  deadline: 600000,
  owner: VALID_OWNER,
  counterparty: VALID_DESTINATION,
};

describe("API Service - Webhook Subscriptions & Lifecycle Dispatcher (Wave Issue #40)", () => {
  const dbClient = createDatabaseClient({
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/stellarclear_test",
    network: "testnet",
  });

  const server = createApiServer(
    {
      port: 3000,
      host: "0.0.0.0",
      network: "testnet",
      databaseUrl: "postgresql://localhost",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    },
    dbClient
  );

  beforeEach(() => {
    server.webhookDispatcher.clear();
  });

  it("registers a new webhook via POST /v1/webhooks", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "https://fintech.example.com/webhooks/settlement",
        secret: "super-secret-key-1234",
        events: ["case.created", "case.matched"],
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = res.body as {
      webhook: {
        id: string;
        url: string;
        events: string[];
        active: boolean;
        secret: string;
      };
    };

    assert.ok(body.webhook.id.startsWith("wh_"));
    assert.strictEqual(body.webhook.url, "https://fintech.example.com/webhooks/settlement");
    assert.deepStrictEqual(body.webhook.events, ["case.created", "case.matched"]);
    assert.strictEqual(body.webhook.active, true);
    assert.strictEqual(body.webhook.secret, "super-secret-key-1234");
  });

  it("validates invalid webhook URLs on registration", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "ftp://invalid-protocol.com",
      },
    });

    assert.strictEqual(res.statusCode, 400);
    const body = res.body as { error?: { code: string }; code?: string };
    const code = body.error ? body.error.code : body.code;
    assert.strictEqual(code, "INVALID_WEBHOOK_PAYLOAD");
  });

  it("lists registered webhooks via GET /v1/webhooks", async () => {
    await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "https://client-a.com/hook",
        events: ["*"],
      },
    });

    const res = await server.inject({
      method: "GET",
      url: "/v1/webhooks",
    });

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as { webhooks: Array<{ id: string; url: string }> };
    assert.strictEqual(body.webhooks.length, 1);
    assert.strictEqual(body.webhooks[0]?.url, "https://client-a.com/hook");
  });

  it("deletes a webhook via DELETE /v1/webhooks/:id and returns 404 for unknown", async () => {
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: { url: "https://to-delete.com/hook" },
    });
    const webhookId = (createRes.body as { webhook: { id: string } }).webhook.id;

    // Delete existing
    const delRes = await server.inject({
      method: "DELETE",
      url: `/v1/webhooks/${webhookId}`,
    });
    assert.strictEqual(delRes.statusCode, 200);
    assert.deepStrictEqual(delRes.body, { deleted: true, id: webhookId });

    // Delete non-existent
    const missingRes = await server.inject({
      method: "DELETE",
      url: `/v1/webhooks/${webhookId}`,
    });
    assert.strictEqual(missingRes.statusCode, 404);
  });

  it("dispatches signed webhook with HMAC-SHA256 upon case creation", async () => {
    let capturedUrl = "";
    let capturedSignature = "";
    let capturedEvent = "";
    let capturedBody = "";

    const customFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      const headers = (init?.headers || {}) as Record<string, string>;
      capturedSignature = headers["x-stellarclear-signature"] || "";
      capturedEvent = headers["x-stellarclear-event"] || "";
      capturedBody = String(init?.body || "");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const dispatcher = new WebhookDispatcher({ fetchFn: customFetch });
    const sub = dispatcher.register({
      url: "https://counterparty.com/callback",
      secret: "webhook-secret-9999",
      events: ["case.created"],
    });

    await dispatcher.dispatch("case.created", {
      caseId: VALID_CASE_ID,
      status: "OPEN",
    });

    assert.strictEqual(capturedUrl, "https://counterparty.com/callback");
    assert.strictEqual(capturedEvent, "case.created");
    assert.ok(capturedBody.includes(VALID_CASE_ID));

    // Verify HMAC-SHA256 signature
    const expectedSig = createHmac("sha256", sub.secret).update(capturedBody).digest("hex");
    assert.strictEqual(capturedSignature, expectedSig);

    const deliveries = dispatcher.getDeliveries();
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0]?.status, "success");
    assert.strictEqual(deliveries[0]?.attempts, 1);
  });

  it("retries failed webhook deliveries with exponential backoff", async () => {
    let attempts = 0;

    const failingFetch: typeof fetch = async () => {
      attempts++;
      if (attempts < 3) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const dispatcher = new WebhookDispatcher({
      maxAttempts: 3,
      baseBackoffMs: 10,
      fetchFn: failingFetch,
    });

    dispatcher.register({
      url: "https://unreliable.org/webhook",
      secret: "retry-secret-1111",
    });

    await dispatcher.dispatch("case.disputed", {
      caseId: VALID_CASE_ID,
      status: "DISPUTED",
    });

    assert.strictEqual(attempts, 3);
    const deliveries = dispatcher.getDeliveries();
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0]?.status, "success");
    assert.strictEqual(deliveries[0]?.attempts, 3);
  });

  it("integrates end-to-end with ApiServer lifecycle state transitions", async () => {
    const dispatchedEvents: string[] = [];

    const mockFetch: typeof fetch = async (_url, init) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      dispatchedEvents.push(headers["x-stellarclear-event"] || "");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    // Replace fetch on server dispatcher
    (server.webhookDispatcher as unknown as { fetchFn: typeof fetch }).fetchFn = mockFetch;

    // Register webhook for all events
    await server.inject({
      method: "POST",
      url: "/v1/webhooks",
      body: {
        url: "https://enterprise.bank/events",
        events: ["*"],
      },
    });

    // Create a case
    const caseRes = await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: {
        expected: SAMPLE_EXPECTED,
      },
    });
    assert.strictEqual(caseRes.statusCode, 201);

    // Wait short tick for asynchronous dispatch
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.ok(dispatchedEvents.includes("case.created"), "Expected case.created to be dispatched via webhook");
  });
});
