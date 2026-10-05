import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupLiveSettlementEnvironment, TEST_LIVE_CONTRACT_ID, TEST_LIVE_NETWORK } from "./helpers/soroban.js";
import { computeTermsCommitment, computeObservationCommitment } from "@stellarclear/proof";
import type {
  ExpectedSettlement,
  ObservedSettlement,
  SettlementProof,
} from "@stellarclear/schemas";
import { SettlementStateSynchronizer, type DecodedContractEvent } from "@stellarclear/indexer";
import { loadApiConfigFromEnv } from "@stellarclear/api";

describe("Integration - Deployed SettlementRegistry End-to-End Lifecycle", () => {
  it("verifies environment and contract configuration loading", () => {
    const config = loadApiConfigFromEnv({
      STELLAR_CONTRACT_ID: TEST_LIVE_CONTRACT_ID,
      STELLAR_NETWORK: TEST_LIVE_NETWORK,
      STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      DATABASE_URL: "postgres://stellarclear:stellarclear@localhost:5432/stellarclear_db",
      ENABLE_ANCHORING: "true",
    });

    assert.strictEqual(config.contractId, TEST_LIVE_CONTRACT_ID);
    assert.strictEqual(config.network, TEST_LIVE_NETWORK);
    assert.strictEqual(config.enableAnchoring, true);
    assert.strictEqual(config.rpcUrl, "https://soroban-testnet.stellar.org");
  });

  it("exercises complete End-to-End lifecycle: Create -> Observe -> Match -> Attest -> Proof -> Finalize -> Sync", async () => {
    const { db, caseRepo, obsRepo, recRepo, soroban, server } = setupLiveSettlementEnvironment();
    const synchronizer = new SettlementStateSynchronizer(db, TEST_LIVE_NETWORK);

    const caseId = "d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1";
    const terms: ExpectedSettlement = {
      caseId,
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TRADE-DEPLOYED-001",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "1000000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-DEPLOYED-101",
      deadline: 1800000,
    };

    // 1. Create Case via API
    const createRes = await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });
    assert.strictEqual(createRes.statusCode, 201);
    const createBody = createRes.body as { caseId: string; status: string; txHash?: string };
    assert.strictEqual(createBody.caseId, caseId);
    assert.strictEqual(createBody.status, "OPEN");
    assert.ok(createBody.txHash);

    // Verify On-Chain Soroban Case
    const onchainCase = await soroban.getOnChainCase(caseId);
    if (!onchainCase) throw new Error("Expected onchainCase to exist");
    assert.strictEqual(onchainCase.termsCommitment, computeTermsCommitment(terms));
    assert.strictEqual(onchainCase.status, "OPEN");

    // 2. Observe Settlement Transaction via API
    const observation: ObservedSettlement = {
      txHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ledger: 1550000,
      asset: terms.asset,
      amount: terms.amount,
      destination: terms.expectedDestination,
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };

    const obsRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation },
    });
    assert.strictEqual(obsRes.statusCode, 200);
    const obsBody = obsRes.body as { status: string; observationCommitment?: string };
    assert.strictEqual(obsBody.status, "OBSERVED");
    assert.ok(obsBody.observationCommitment);

    // Verify On-Chain Observation State
    const onchainObsCase = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainObsCase?.status, "OBSERVED");
    assert.strictEqual(
      onchainObsCase?.observation?.observationCommitment,
      computeObservationCommitment(observation)
    );

    // 3. Automated Reconciliation via API -> Match on Soroban
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; matched: boolean };
    assert.strictEqual(recBody.status, "MATCHED");
    assert.strictEqual(recBody.matched, true);

    const onchainMatched = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainMatched?.status, "MATCHED");

    // 4. Submit Participant Attestations via API
    const attestRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/attest`,
      body: {
        attestor: terms.owner,
        role: "OWNER",
        commitment: computeTermsCommitment(terms),
      },
    });
    assert.strictEqual(attestRes.statusCode, 201);

    const onchainAtt = await soroban.getOnChainAttestation(caseId, terms.owner);
    if (!onchainAtt) throw new Error("Expected onchainAtt to exist");
    assert.strictEqual(onchainAtt.role, "OWNER");

    // 5. Query Audit Trail
    const auditRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/audit`,
    });
    assert.strictEqual(auditRes.statusCode, 200);
    const auditBody = auditRes.body as { events: unknown[] };
    assert.ok(auditBody.events.length >= 4);

    // 6. Generate & Export Proof Artifact
    const proofRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/proof`,
    });
    assert.strictEqual(proofRes.statusCode, 200);
    const proofArtifact = proofRes.body as SettlementProof;
    assert.strictEqual(proofArtifact.caseId, caseId);
    assert.strictEqual(proofArtifact.result, "MATCHED");

    // 7. Verify Proof against Live Soroban Contract State
    const verifyRes = await server.inject({
      method: "POST",
      url: "/v1/proofs/verify/onchain",
      body: {
        proof: proofArtifact,
        termsDocument: terms,
        observedDocument: observation,
      },
    });
    assert.strictEqual(verifyRes.statusCode, 200);
    const verifyBody = verifyRes.body as { valid: boolean };
    assert.strictEqual(verifyBody.valid, true);

    // 8. Finalize Case on Soroban
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/finalize`,
      body: {
        finalizer: terms.owner,
      },
    });
    assert.strictEqual(finRes.statusCode, 200);
    const finBody = finRes.body as { status: string; finalizedAtLedger?: number; txHash?: string };
    assert.strictEqual(finBody.status, "FINALIZED");
    assert.ok(finBody.finalizedAtLedger);

    const onchainFinal = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainFinal?.status, "FINALIZED");

    // 9. Synchronize State via Indexer
    const event: DecodedContractEvent = {
      type: "CaseFinalized",
      contractId: TEST_LIVE_CONTRACT_ID,
      ledger: Number(finBody.finalizedAtLedger),
      txHash: finBody.txHash || "0x_fin_hash",
      cursor: "cursor-101",
      topicXdr: "AAA=",
      dataXdr: "BBB=",
      caseId,
      payload: {
        caseId,
        finalizedAtLedger: finBody.finalizedAtLedger,
      },
    };
    const syncRes = await synchronizer.syncBatch([event]);
    assert.strictEqual(syncRes.eventsProcessed, 1);
    assert.strictEqual(syncRes.casesUpdated, 1);

    // 10. Check Consistency between DB, Indexer, and On-Chain Soroban
    const consistencyRes = await server.inject({
      method: "GET",
      url: `/v1/cases/${caseId}/consistency`,
    });
    assert.strictEqual(consistencyRes.statusCode, 200);
    const consistencyBody = consistencyRes.body as { isConsistent: boolean; consistencyStatus: string };
    assert.strictEqual(consistencyBody.isConsistent, true);
    assert.strictEqual(consistencyBody.consistencyStatus, "CONSISTENT");
  });

  it("exercises Break, Dispute, and Resolution lifecycle on Soroban contract", async () => {
    const { caseRepo, obsRepo, soroban, server } = setupLiveSettlementEnvironment();

    const caseId = "d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2";
    const terms: ExpectedSettlement = {
      caseId,
      owner: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      counterparty: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      tradeReference: "TRADE-DEPLOYED-BREAK",
      asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "250000.00",
      expectedDestination: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ",
      reference: "INV-DEPLOYED-BREAK",
      deadline: 1800000,
    };

    // Create case
    await server.inject({
      method: "POST",
      url: "/v1/cases",
      body: { expected: terms },
    });

    // Observe underpayment (Break)
    const brokenObs: ObservedSettlement = {
      txHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ledger: 1560000,
      asset: terms.asset,
      amount: "200000.00", // Short by 50,000.00
      destination: terms.expectedDestination,
      reference: terms.reference,
      status: "SUCCESS",
      observedAt: new Date().toISOString(),
    };

    await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/observe`,
      body: { observation: brokenObs },
    });

    // Reconcile -> Break recorded on Soroban
    const recRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/reconcile`,
    });
    assert.strictEqual(recRes.statusCode, 200);
    const recBody = recRes.body as { status: string; matched: boolean; breaks: { code: string }[] };
    assert.strictEqual(recBody.status, "BREAK");
    assert.strictEqual(recBody.matched, false);
    assert.strictEqual(recBody.breaks[0]?.code, "AMOUNT_MISMATCH");

    // Open Dispute
    const disputeRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/dispute`,
      body: {
        initiator: terms.owner,
        reason: "Observed settlement amount 200000.00 does not match expected 250000.00",
      },
    });
    assert.strictEqual(disputeRes.statusCode, 201);
    const disputeBody = disputeRes.body as { status: string };
    assert.strictEqual(disputeBody.status, "DISPUTED");

    // Submit Resolution (Both counterparty and owner submit matching resolution)
    const counterparty = terms.counterparty ?? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const resolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/resolve`,
      body: {
        resolver: counterparty,
        resolutionType: "ACCEPT_PARTIAL",
        agreedAmount: "200000.00",
        resolutionCommitment: "f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6",
      },
    });
    assert.strictEqual(resolveRes.statusCode, 200);

    const ownerResolveRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/resolve`,
      body: {
        resolver: terms.owner,
        resolutionType: "ACCEPT_PARTIAL",
        agreedAmount: "200000.00",
        resolutionCommitment: "f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6",
      },
    });
    assert.strictEqual(ownerResolveRes.statusCode, 200);
    const resolveBody = ownerResolveRes.body as { status: string };
    assert.strictEqual(resolveBody.status, "RESOLVED");

    // Finalize
    const finRes = await server.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/finalize`,
      body: { finalizer: terms.owner },
    });
    assert.strictEqual(finRes.statusCode, 200);

    const onchainFinal = await soroban.getOnChainCase(caseId);
    assert.strictEqual(onchainFinal?.status, "FINALIZED");
  });
});
