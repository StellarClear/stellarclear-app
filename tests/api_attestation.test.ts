import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDatabaseClient } from "@stellarclear/db";
import { createApiServer, SorobanSettlementAnchor, type OnChainAnchorService } from "@stellarclear/api";
import { computeTermsCommitment } from "@stellarclear/proof";
import type { ExpectedSettlement, AttestationRole } from "@stellarclear/schemas";
import type { TransactionResult } from "@stellarclear/sdk";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_NETWORK = "testnet";

class MockAnchorService extends SorobanSettlementAnchor {
  public attestationCalls: Array<{
    attestor: string;
    caseId: string;
    role: AttestationRole;
    commitment: string;
  }> = [];

  public override async anchorAttestation(params: {
    attestor: string;
    caseId: string;
    role: AttestationRole;
    commitment: string;
  }): Promise<TransactionResult<void>> {
    this.attestationCalls.push(params);
    return {
      txHash: `0x_attest_tx_${params.caseId.slice(0, 8)}`,
      status: "SUCCESS",
      ledger: 1234570,
      result: undefined,
    };
  }
}

describe("API Service - Attestation Lifecycle", () => {
  const sampleTerms: ExpectedSettlement = {
    caseId: "2222222222222222222222222222222222222222222222222222222222222222",
    owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    tradeReference: "TRADE-ATTEST-001",
    asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    amount: "10000.00",
    expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
    deadline: 1234567,
  };

  const termsCommitment = computeTermsCommitment(sampleTerms);

  function setup() {
    const db = new InMemoryDatabaseClient();
    const anchor = new MockAnchorService();
    const server = createApiServer(
      {
        port: 3000,
        host: "0.0.0.0",
        network: TEST_NETWORK,
        databaseUrl: "postgres://localhost:5432/test",
        contractId: TEST_CONTRACT_ID,
      },
      db,
      anchor
    );
    return { db, anchor, server };
  }

  it("records and anchors an OWNER attestation", async () => {
    const { server, anchor } = setup();

    // 1. Create case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    // 2. Submit attestation
    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/attest`,
      body: {
        role: "OWNER",
        attestor: sampleTerms.owner,
        commitment: termsCommitment,
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = res.body as {
      caseId: string;
      role: string;
      attestor: string;
      commitment: string;
      txHash: string;
    };
    assert.strictEqual(body.caseId, sampleTerms.caseId);
    assert.strictEqual(body.role, "OWNER");
    assert.strictEqual(body.attestor, sampleTerms.owner);
    assert.strictEqual(body.commitment, termsCommitment);
    assert.strictEqual(body.txHash, `0x_attest_tx_${sampleTerms.caseId.slice(0, 8)}`);
    assert.strictEqual(anchor.attestationCalls.length, 1);
  });

  it("records and anchors COUNTERPARTY and OBSERVER attestations", async () => {
    const { server, anchor } = setup();

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    const observerAddress = "GCAXSG54U2466J366EODG6F2X723C73YLYV7GDT57V46F2HN33VDUS5B";

    // Counterparty attestation
    const cpRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/attest`,
      body: {
        role: "COUNTERPARTY",
        attestor: sampleTerms.counterparty,
        commitment: termsCommitment,
      },
    });
    assert.strictEqual(cpRes.statusCode, 201);

    // Observer attestation
    const obsRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/attest`,
      body: {
        role: "OBSERVER",
        attestor: observerAddress,
        commitment: termsCommitment,
      },
    });
    assert.strictEqual(obsRes.statusCode, 201);
    assert.strictEqual(anchor.attestationCalls.length, 2);
  });

  it("rejects attestation from unauthorized party claiming OWNER role (403)", async () => {
    const { server } = setup();

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    const imposter = "GCAXSG54U2466J366EODG6F2X723C73YLYV7GDT57V46F2HN33VDUS5B";
    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/attest`,
      body: {
        role: "OWNER",
        attestor: imposter,
        commitment: termsCommitment,
      },
    });

    assert.strictEqual(res.statusCode, 403);
  });

  it("returns 404 for non-existent case attestation", async () => {
    const { server } = setup();

    const res = await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/attest`,
      body: {
        role: "OWNER",
        attestor: sampleTerms.owner,
        commitment: termsCommitment,
      },
    });

    assert.strictEqual(res.statusCode, 404);
  });

  it("lists all attestations via GET /v1/cases/:caseId/attestations", async () => {
    const { server } = setup();

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: sampleTerms },
    });

    await server.inject({
      method: "POST",
      url: `/v1/cases/${sampleTerms.caseId}/attest`,
      body: {
        role: "OWNER",
        attestor: sampleTerms.owner,
        commitment: termsCommitment,
      },
    });

    const listRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${sampleTerms.caseId}/attestations`,
    });

    assert.strictEqual(listRes.statusCode, 200);
    const body = listRes.body as {
      caseId: string;
      attestations: unknown[];
      requiredObserverQuorum: number;
      distinctObserverCount: number;
      quorumSatisfied: boolean;
    };
    assert.strictEqual(body.caseId, sampleTerms.caseId);
    assert.strictEqual(body.attestations.length, 1);
    assert.strictEqual(body.requiredObserverQuorum, 1);
    assert.strictEqual(body.distinctObserverCount, 0); // Only OWNER submitted, not OBSERVER
    assert.strictEqual(body.quorumSatisfied, false);
  });

  it("exposes distinct observer quorum verification details and enforces threshold (TASK A & K)", async () => {
    const { server } = setup();

    const caseId = "7777777777777777777777777777777777777777777777777777777777777777";
    const terms = {
      ...sampleTerms,
      caseId,
      observerQuorum: 2, // Quorum of 2 required
    };

    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    const obs1 = "G" + "A".repeat(55);
    const obs2 = "G" + "B".repeat(55);

    // 1. Submit OWNER attestation — must NOT count towards observer quorum
    const ownerAttRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: { role: "OWNER", attestor: terms.owner, commitment: termsCommitment },
    });
    assert.strictEqual(ownerAttRes.statusCode, 201);

    let quorumRes = await server.inject({ method: "GET", url: `/v1/cases/${caseId}/quorum` });
    assert.strictEqual(quorumRes.statusCode, 200);
    let qBody = quorumRes.body as {
      requiredObserverQuorum: number;
      distinctObserverCount: number;
      submittedObserverCount: number;
      quorumSatisfied: boolean;
    };
    assert.strictEqual(qBody.requiredObserverQuorum, 2);
    assert.strictEqual(qBody.distinctObserverCount, 0);
    assert.strictEqual(qBody.quorumSatisfied, false);

    // 2. Submit First OBSERVER attestation (1 distinct)
    const obs1Res = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: { role: "OBSERVER", attestor: obs1, commitment: termsCommitment },
    });
    assert.strictEqual(obs1Res.statusCode, 201);

    quorumRes = await server.inject({ method: "GET", url: `/v1/cases/${caseId}/quorum` });
    qBody = quorumRes.body as typeof qBody;
    assert.strictEqual(qBody.distinctObserverCount, 1);
    assert.strictEqual(qBody.quorumSatisfied, false);

    // 3. Duplicate OBSERVER submission by same observer — must NOT increment distinct count
    const dupRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: { role: "OBSERVER", attestor: obs1, commitment: termsCommitment },
    });
    assert.strictEqual(dupRes.statusCode, 201);

    quorumRes = await server.inject({ method: "GET", url: `/v1/cases/${caseId}/quorum` });
    qBody = quorumRes.body as typeof qBody;
    assert.strictEqual(qBody.distinctObserverCount, 1);
    assert.strictEqual(qBody.submittedObserverCount, 1);
    assert.strictEqual(qBody.quorumSatisfied, false);

    // 4. Second distinct OBSERVER attestation — quorum now satisfied!
    const obs2Res = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: { role: "OBSERVER", attestor: obs2, commitment: termsCommitment },
    });
    assert.strictEqual(obs2Res.statusCode, 201);

    quorumRes = await server.inject({ method: "GET", url: `/v1/cases/${caseId}/quorum` });
    qBody = quorumRes.body as typeof qBody;
    assert.strictEqual(qBody.distinctObserverCount, 2);
    assert.strictEqual(qBody.quorumSatisfied, true);

    // 5. Also verify GET /v1/cases/:caseId/attestations exposes the same verification status
    const listRes = await server.inject({ method: "GET", url: `/v1/cases/${caseId}/attestations` });
    const listBody = listRes.body as {
      requiredObserverQuorum: number;
      distinctObserverCount: number;
      quorumSatisfied: boolean;
      distinctObservers: string[];
    };
    assert.strictEqual(listBody.requiredObserverQuorum, 2);
    assert.strictEqual(listBody.distinctObserverCount, 2);
    assert.strictEqual(listBody.quorumSatisfied, true);
    assert.deepStrictEqual(listBody.distinctObservers.sort(), [obs1, obs2].sort());
  });
});
