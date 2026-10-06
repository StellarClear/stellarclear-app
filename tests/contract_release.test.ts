import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SETTLEMENT_REGISTRY_RELEASE,
  getPinnedContractRelease,
  verifyContractReleaseCompatibility,
} from "settlement-registry";
import {
  getPinnedContractRelease as getSdkPinnedRelease,
  verifyContractReleaseCompatibility as verifySdkCompatibility,
} from "@stellarclear/sdk";

describe("SettlementRegistry - Pinned Contract Release", () => {
  it("exports complete pinned release metadata", () => {
    const release = getPinnedContractRelease();
    assert.strictEqual(release.name, "settlement_registry");
    assert.strictEqual(release.version, "0.1.1");
    assert.strictEqual(release.releaseTag, "v0.1.1");
    assert.strictEqual(release.specVersion, 1);
    assert.strictEqual(
      release.wasmHash,
      "0073a4cb2027140ac34e4db6c64c2d4104590ec60cf0ef2e424909eba9ae36ac"
    );
    assert.strictEqual(
      release.gitCommit,
      "2032666be97e8bf09ba9073952041ae3e4573ff1"
    );
    assert.strictEqual(
      release.contractRepository,
      "https://github.com/StellarClear/stellarclear-contract"
    );
    assert.strictEqual(
      release.artifactFile,
      "artifacts/settlement_registry.wasm"
    );
    assert.ok(release.features.includes("case_creation"));
    assert.ok(release.features.includes("observation_anchoring"));
    assert.ok(release.features.includes("match_reconciliation"));
    assert.ok(release.features.includes("break_classification"));
    assert.ok(release.features.includes("dispute_workflows"));
    assert.ok(release.features.includes("arbitration_resolution"));
    assert.ok(release.features.includes("multi_party_attestations"));
    assert.ok(release.features.includes("onchain_finalization"));
    assert.ok(release.features.includes("observer_quorum"));
    assert.ok(release.features.includes("dispute_expiration"));
  });

  it("exposes pinned release metadata identically via @stellarclear/sdk", () => {
    const sdkRelease = getSdkPinnedRelease();
    assert.deepStrictEqual(sdkRelease, SETTLEMENT_REGISTRY_RELEASE);
  });

  it("verifies contract deployment compatibility against standard networks", () => {
    // Valid testnet
    const testnetCheck = verifyContractReleaseCompatibility("testnet");
    assert.strictEqual(testnetCheck.compatible, true);

    // Valid local
    const localCheck = verifyContractReleaseCompatibility("local");
    assert.strictEqual(localCheck.compatible, true);

    // Valid custom contract ID on testnet
    const customValid = verifyContractReleaseCompatibility(
      "testnet",
      "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5"
    );
    assert.strictEqual(customValid.compatible, true);

    // Invalid network
    const badNetwork = verifyContractReleaseCompatibility("unknown_chain");
    assert.strictEqual(badNetwork.compatible, false);
    assert.ok(badNetwork.reason?.includes("not a recognized deployment network"));

    // Invalid contract format
    const badContract = verifyContractReleaseCompatibility("testnet", "invalid_id");
    assert.strictEqual(badContract.compatible, false);
    assert.ok(badContract.reason?.includes("not a valid StrKey contract address"));
  });

  it("SDK re-export of verifyContractReleaseCompatibility functions correctly", () => {
    const check = verifySdkCompatibility("testnet");
    assert.strictEqual(check.compatible, true);
  });
});
