/**
 * Authoritative pinned release metadata and configuration for the Soroban SettlementRegistry contract.
 */
export interface ContractNetworkDeployment {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  deployedAtLedger?: number;
}

export interface SettlementRegistryRelease {
  name: string;
  version: string;
  releaseTag: string;
  contractRepository?: string;
  gitCommit?: string;
  artifactFile?: string;
  wasmHash: string;
  specVersion: number;
  deployedNetworks: Record<string, ContractNetworkDeployment>;
  historicalPrototypes?: Record<
    string,
    { contractId: string; wasmHash: string; releaseTag: string }
  >;
  features: readonly string[];
}

export const SETTLEMENT_REGISTRY_RELEASE: SettlementRegistryRelease = {
  name: "settlement_registry",
  version: "0.1.1",
  releaseTag: "v0.1.1",
  contractRepository: "https://github.com/StellarClear/stellarclear-contract",
  gitCommit: "2032666be97e8bf09ba9073952041ae3e4573ff1",
  artifactFile: "artifacts/settlement_registry.wasm",
  wasmHash: "0073a4cb2027140ac34e4db6c64c2d4104590ec60cf0ef2e424909eba9ae36ac",
  specVersion: 1,
  deployedNetworks: {
    testnet: {
      contractId: "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      deployedAtLedger: 5048699,
    },
    local: {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      networkPassphrase: "Standalone Network ; February 2024",
      rpcUrl: "http://localhost:8000/soroban/rpc",
      deployedAtLedger: 1,
    },
  },
  historicalPrototypes: {
    v0_1_0_testnet: {
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      wasmHash: "1018a81b1ac95046cb00466ceda7ee347204c08b71b1c51b3c9611dd32215d66",
      releaseTag: "v0.1.0",
    },
  },
  features: [
    "case_creation",
    "observation_anchoring",
    "match_reconciliation",
    "break_classification",
    "dispute_workflows",
    "arbitration_resolution",
    "multi_party_attestations",
    "onchain_finalization",
    "observer_quorum",
    "dispute_expiration",
  ],
} as const;

/**
 * Retrieves pinned release metadata for the SettlementRegistry contract.
 */
export function getPinnedContractRelease(): SettlementRegistryRelease {
  return SETTLEMENT_REGISTRY_RELEASE;
}

/**
 * Verifies whether a given contract deployment and network matches or is compatible with the pinned release.
 */
export function verifyContractReleaseCompatibility(
  network: string,
  contractId?: string
): { compatible: boolean; reason?: string } {
  const deployment = SETTLEMENT_REGISTRY_RELEASE.deployedNetworks[network];
  if (!deployment && network !== "mainnet" && network !== "testnet" && network !== "local") {
    return {
      compatible: false,
      reason: `Network '${network}' is not a recognized deployment network for SettlementRegistry ${SETTLEMENT_REGISTRY_RELEASE.version}`,
    };
  }

  if (contractId && deployment && deployment.contractId !== contractId && deployment.contractId !== "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM") {
    // Custom deployed instance on standard network is supported if format is valid
    if (!contractId.startsWith("C") || contractId.length !== 56) {
      return {
        compatible: false,
        reason: `Contract ID '${contractId}' is not a valid StrKey contract address`,
      };
    }
  }

  return { compatible: true };
}
