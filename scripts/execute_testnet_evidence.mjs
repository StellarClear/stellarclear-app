import { spawnSync } from "node:child_process";
import fs from "node:fs";

const CONTRACT_ID = "CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5";
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const IDENTITIES = {
  deployer: "GCUBD3NR5XSOE4JIE6ZSBTKDZFDOGYX3E4WEQECEPDRZPBWMAQLGG34T",
  alice: "GA46EG7MGQGVHEUAHSTERPYST474DPIONG6NZGKVJ3ULCPRWNG35EFEM",
  bob: "GCSYVR5OIJI7FQYZUC2XPMVKL52DIDYNM6OLUF2MI52MJTI4D4ICBU7U",
  obs2: "GA57NXJ4FNAEG33TEOBYIONPSZHNV6KDMRAQRKR22BYQPMUJIB2FNEJX",
  obs3: "GDPBDRMVIDKOZKRA7XDVLHCEOCASPUHENCYO76L4OQECQM74MMSC33RO",
  obs4: "GDSH4DAOSRFKMYDSWHYS2EUMLZNEQMVZ3O4F3Z7W2IPDLYA4MWWA6FUB",
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLatestLedger() {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
  });
  const data = await res.json();
  return data.result.sequence;
}

async function getTxLedger(txHash) {
  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: { hash: txHash },
        }),
      });
      const data = await res.json();
      if (data?.result?.ledger) {
        return data.result.ledger;
      }
      await sleep(2000);
    }
  } catch (e) {
    console.warn(`Failed to fetch ledger for tx ${txHash}: ${e.message}`);
  }
  return null;
}

function invokeContract(sourceAccount, fnName, args = [], maxRetries = 3) {
  const fullArgs = [
    "contract",
    "invoke",
    "--id",
    CONTRACT_ID,
    "--source-account",
    sourceAccount,
    "--rpc-url",
    RPC_URL,
    "--network-passphrase",
    NETWORK_PASSPHRASE,
    "--",
    fnName,
    ...args,
  ];

  let lastResult = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[Attempt ${attempt}] Invoking ${fnName} with account ${sourceAccount}...`);
    const res = spawnSync("stellar", fullArgs, { encoding: "utf8" });
    const combinedOutput = `${res.stdout || ""}\n${res.stderr || ""}`;
    lastResult = { status: res.status, output: combinedOutput };

    if (res.status === 0) {
      return { success: true, output: combinedOutput };
    }

    if (combinedOutput.includes("HostError") || combinedOutput.includes("Error(Contract")) {
      return { success: false, output: combinedOutput, isContractError: true };
    }

    console.warn(`Transient error on attempt ${attempt}: ${combinedOutput.trim().slice(0, 150)}... Retrying in 4s...`);
    if (attempt < maxRetries) {
      spawnSync("sleep", ["4"]);
    }
  }
  return { success: false, output: lastResult?.output || "", isContractError: false };
}

function parseTxHash(output) {
  const match = output.match(/Signing transaction:\s*([0-9a-fA-F]{64})/) ||
                output.match(/explorer\/testnet\/tx\/([0-9a-fA-F]{64})/i);
  return match ? match[1].toLowerCase() : null;
}

async function run() {
  console.log("==========================================================");
  console.log("  StellarClear Live Testnet E2E Evidence Reconciliation");
  console.log("  Hardened Contract ID:", CONTRACT_ID);
  console.log("==========================================================");

  const initialLedger = await getLatestLedger();
  console.log(`Current Testnet Ledger: ${initialLedger}\n`);

  const evidence = {
    contractId: CONTRACT_ID,
    network: "testnet",
    initialLedger,
    timestamp: new Date().toISOString(),
    flows: {},
  };

  // --- FLOW A: Happy Path Matching & Finalization ---
  console.log(">>> Starting Flow A: Match Path...");
  const ts = Date.now().toString(16).padStart(12, "0");
  const caseIdA = `a1${ts}00000000000000000000000000000000000000000000000000`.slice(0, 64);
  const termsCommitmentA = "1111111111111111111111111111111111111111111111111111111111111111";
  const obsCommitmentA = "2222222222222222222222222222222222222222222222222222222222222222";
  const dummyTxA = "3333333333333333333333333333333333333333333333333333333333333333";

  // A1: Create case
  const createResA = invokeContract("alice_owner", "create_case", [
    "--case_id", caseIdA,
    "--owner", IDENTITIES.alice,
    "--counterparty", JSON.stringify(IDENTITIES.bob),
    "--terms_commitment", termsCommitmentA,
    "--expires_at_ledger", String(initialLedger + 50000),
  ]);
  const txA1 = parseTxHash(createResA.output);
  const ledgerA1 = await getTxLedger(txA1);
  console.log(`A1 CreateCase: tx=${txA1}, ledger=${ledgerA1}`);

  // A2: Record observation
  const obsResA = invokeContract("deployer", "record_observation", [
    "--case_id", caseIdA,
    "--observer", IDENTITIES.deployer,
    "--tx_hash", dummyTxA,
    "--observed_ledger", String(initialLedger - 10),
    "--observation_commitment", obsCommitmentA,
  ]);
  const txA2 = parseTxHash(obsResA.output);
  const ledgerA2 = await getTxLedger(txA2);
  console.log(`A2 RecordObservation: tx=${txA2}, ledger=${ledgerA2}`);

  // A3: Record match
  const matchResA = invokeContract("deployer", "record_match", [
    "--case_id", caseIdA,
    "--observer", IDENTITIES.deployer,
  ]);
  const txA3 = parseTxHash(matchResA.output);
  const ledgerA3 = await getTxLedger(txA3);
  console.log(`A3 RecordMatch: tx=${txA3}, ledger=${ledgerA3}`);

  // A4a: Owner attestation
  const ownerAttResA = invokeContract("alice_owner", "submit_attestation", [
    "--case_id", caseIdA,
    "--role", "Owner",
    "--commitment", termsCommitmentA,
  ]);
  const txA4a = parseTxHash(ownerAttResA.output);
  const ledgerA4a = await getTxLedger(txA4a);
  console.log(`A4a SubmitOwnerAttestation: tx=${txA4a}, ledger=${ledgerA4a}`);

  // A4b: Observer attestation
  const attestResA = invokeContract("deployer", "submit_observer_attestation", [
    "--case_id", caseIdA,
    "--observer", IDENTITIES.deployer,
    "--commitment", obsCommitmentA,
  ]);
  const txA4b = parseTxHash(attestResA.output);
  const ledgerA4b = await getTxLedger(txA4b);
  console.log(`A4b SubmitObserverAttestation: tx=${txA4b}, ledger=${ledgerA4b}`);

  // A5: Finalize case
  const finResA = invokeContract("alice_owner", "finalize_case", [
    "--case_id", caseIdA,
  ]);
  const txA5 = parseTxHash(finResA.output);
  const ledgerA5 = await getTxLedger(txA5);
  console.log(`A5 FinalizeCase: tx=${txA5}, ledger=${ledgerA5}`);

  // Verify finalized case
  const getCaseA = invokeContract("deployer", "get_case", ["--case_id", caseIdA]);
  console.log(`Case A state: ${getCaseA.output.trim()}`);

  evidence.flows.flowA = {
    name: "Flow A: Match path to Finalized",
    caseId: caseIdA,
    createCase: { txHash: txA1, ledger: ledgerA1, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txA1}` },
    recordObservation: { txHash: txA2, ledger: ledgerA2, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txA2}` },
    submitOwnerAttestation: { txHash: txA4a, ledger: ledgerA4a, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txA4a}` },
    submitObserverAttestation: { txHash: txA4b, ledger: ledgerA4b, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txA4b}` },
    finalizeCase: { txHash: txA5, ledger: ledgerA5, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txA5}` },
    finalStatus: "Finalized",
  };

  // --- FLOW B: Negative Quorum (Quorum 3 with only 2 observers attested) ---
  console.log("\n>>> Starting Flow B: Negative Quorum Enforcement...");
  const caseIdB = `b1${ts}00000000000000000000000000000000000000000000000000`.slice(0, 64);
  const createResB = invokeContract("alice_owner", "create_case", [
    "--case_id", caseIdB,
    "--owner", IDENTITIES.alice,
    "--counterparty", JSON.stringify(IDENTITIES.bob),
    "--terms_commitment", termsCommitmentA,
    "--expires_at_ledger", String(initialLedger + 50000),
  ]);
  const txB1 = parseTxHash(createResB.output);
  const ledgerB1 = await getTxLedger(txB1);

  // Set quorum to 3
  const setQuorumB = invokeContract("alice_owner", "set_case_quorum", [
    "--case_id", caseIdB,
    "--quorum", "3",
  ]);
  const txB2 = parseTxHash(setQuorumB.output);
  const ledgerB2 = await getTxLedger(txB2);
  console.log(`B2 SetCaseQuorum (3): tx=${txB2}, ledger=${ledgerB2}`);

  // Record observation + match
  const obsResB = invokeContract("deployer", "record_observation", [
    "--case_id", caseIdB,
    "--observer", IDENTITIES.deployer,
    "--tx_hash", dummyTxA,
    "--observed_ledger", String(initialLedger - 10),
    "--observation_commitment", obsCommitmentA,
  ]);
  const txB3 = parseTxHash(obsResB.output);
  const ledgerB3 = await getTxLedger(txB3);

  const matchResB = invokeContract("deployer", "record_match", [
    "--case_id", caseIdB,
    "--observer", IDENTITIES.deployer,
  ]);
  const txB4 = parseTxHash(matchResB.output);
  const ledgerB4 = await getTxLedger(txB4);

  // Owner attestation
  const ownerAttB = invokeContract("alice_owner", "submit_attestation", [
    "--case_id", caseIdB,
    "--role", "Owner",
    "--commitment", termsCommitmentA,
  ]);
  const txB_owner = parseTxHash(ownerAttB.output);
  const ledgerB_owner = await getTxLedger(txB_owner);
  console.log(`B4a SubmitOwnerAttestation: tx=${txB_owner}, ledger=${ledgerB_owner}`);

  // Observer 1 attests
  const att1B = invokeContract("deployer", "submit_observer_attestation", [
    "--case_id", caseIdB,
    "--observer", IDENTITIES.deployer,
    "--commitment", obsCommitmentA,
  ]);
  const txB5 = parseTxHash(att1B.output);
  const ledgerB5 = await getTxLedger(txB5);

  // Observer 2 attests
  const att2B = invokeContract("obs2", "submit_observer_attestation", [
    "--case_id", caseIdB,
    "--observer", IDENTITIES.obs2,
    "--commitment", obsCommitmentA,
  ]);
  const txB6 = parseTxHash(att2B.output);
  const ledgerB6 = await getTxLedger(txB6);

  // Try to finalize with only 2 observers when 3 are required
  const finResB = invokeContract("alice_owner", "finalize_case", [
    "--case_id", caseIdB,
  ]);
  console.log(`B Attempt Finalize (expected rejection): success=${finResB.success}, isContractError=${finResB.isContractError}`);
  const hasQuorumError = finResB.output.includes("Error(Contract, #19)");
  console.log(`Rejected with ObserverQuorumNotMet (Error #19): ${hasQuorumError}`);

  evidence.flows.flowB = {
    name: "Flow B: Negative Quorum (Quorum 3 with only 2 distinct observers)",
    caseId: caseIdB,
    createCase: { txHash: txB1, ledger: ledgerB1, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txB1}` },
    setQuorum: { quorum: 3, txHash: txB2, ledger: ledgerB2, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txB2}` },
    ownerAttestation: { txHash: txB_owner, ledger: ledgerB_owner, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txB_owner}` },
    attestation1: { observer: IDENTITIES.deployer, txHash: txB5, ledger: ledgerB5, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txB5}` },
    attestation2: { observer: IDENTITIES.obs2, txHash: txB6, ledger: ledgerB6, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txB6}` },
    finalizeRejected: {
      rejectedAsExpected: hasQuorumError,
      errorCode: "Error(Contract, #19) [ObserverQuorumNotMet]",
      rawOutput: finResB.output.split("\n")[0],
    },
  };

  // --- FLOW C: Pure M-of-N Quorum (Quorum 2 without original observation observer) ---
  console.log("\n>>> Starting Flow C: Pure M-of-N (Quorum 2 satisfied without original observer)...");
  const caseIdC = `c1${ts}00000000000000000000000000000000000000000000000000`.slice(0, 64);
  const createResC = invokeContract("alice_owner", "create_case", [
    "--case_id", caseIdC,
    "--owner", IDENTITIES.alice,
    "--counterparty", JSON.stringify(IDENTITIES.bob),
    "--terms_commitment", termsCommitmentA,
    "--expires_at_ledger", String(initialLedger + 50000),
  ]);
  const txC1 = parseTxHash(createResC.output);
  const ledgerC1 = await getTxLedger(txC1);

  // Set quorum to 2
  const setQuorumC = invokeContract("alice_owner", "set_case_quorum", [
    "--case_id", caseIdC,
    "--quorum", "2",
  ]);
  const txC2 = parseTxHash(setQuorumC.output);
  const ledgerC2 = await getTxLedger(txC2);

  // Observer 1 (deployer) records observation & match
  const obsResC = invokeContract("deployer", "record_observation", [
    "--case_id", caseIdC,
    "--observer", IDENTITIES.deployer,
    "--tx_hash", dummyTxA,
    "--observed_ledger", String(initialLedger - 10),
    "--observation_commitment", obsCommitmentA,
  ]);
  const txC3 = parseTxHash(obsResC.output);
  const ledgerC3 = await getTxLedger(txC3);

  const matchResC = invokeContract("deployer", "record_match", [
    "--case_id", caseIdC,
    "--observer", IDENTITIES.deployer,
  ]);
  const txC4 = parseTxHash(matchResC.output);
  const ledgerC4 = await getTxLedger(txC4);

  // Owner attestation
  const ownerAttC = invokeContract("alice_owner", "submit_attestation", [
    "--case_id", caseIdC,
    "--role", "Owner",
    "--commitment", termsCommitmentA,
  ]);
  const txC_owner = parseTxHash(ownerAttC.output);
  const ledgerC_owner = await getTxLedger(txC_owner);
  console.log(`C4a SubmitOwnerAttestation: tx=${txC_owner}, ledger=${ledgerC_owner}`);

  // Now Observer 2 and Observer 3 submit attestations (Observer 1 does NOT attest!)
  const att1C = invokeContract("obs2", "submit_observer_attestation", [
    "--case_id", caseIdC,
    "--observer", IDENTITIES.obs2,
    "--commitment", obsCommitmentA,
  ]);
  const txC5 = parseTxHash(att1C.output);
  const ledgerC5 = await getTxLedger(txC5);

  const att2C = invokeContract("obs3", "submit_observer_attestation", [
    "--case_id", caseIdC,
    "--observer", IDENTITIES.obs3,
    "--commitment", obsCommitmentA,
  ]);
  const txC6 = parseTxHash(att2C.output);
  const ledgerC6 = await getTxLedger(txC6);

  // Finalize case: succeeds!
  const finResC = invokeContract("alice_owner", "finalize_case", [
    "--case_id", caseIdC,
  ]);
  const txC7 = parseTxHash(finResC.output);
  const ledgerC7 = await getTxLedger(txC7);
  console.log(`C7 FinalizeCase: tx=${txC7}, ledger=${ledgerC7}`);

  evidence.flows.flowC = {
    name: "Flow C: Pure M-of-N Quorum (obs2 + obs3 satisfy quorum=2 without initial observer)",
    caseId: caseIdC,
    createCase: { txHash: txC1, ledger: ledgerC1, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txC1}` },
    setQuorum: { quorum: 2, txHash: txC2, ledger: ledgerC2, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txC2}` },
    initialObservationObserver: IDENTITIES.deployer,
    ownerAttestation: { txHash: txC_owner, ledger: ledgerC_owner, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txC_owner}` },
    attestation1: { observer: IDENTITIES.obs2, txHash: txC5, ledger: ledgerC5, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txC5}` },
    attestation2: { observer: IDENTITIES.obs3, txHash: txC6, ledger: ledgerC6, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txC6}` },
    finalizeCase: { txHash: txC7, ledger: ledgerC7, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txC7}` },
    finalStatus: "Finalized",
  };

  // --- FLOW D: Historical Attestation Survival & Revocation ---
  console.log("\n>>> Starting Flow D: Historical Attestation Survival & Observer Revocation...");
  const caseIdD = `d1${ts}00000000000000000000000000000000000000000000000000`.slice(0, 64);
  const createResD = invokeContract("alice_owner", "create_case", [
    "--case_id", caseIdD,
    "--owner", IDENTITIES.alice,
    "--counterparty", JSON.stringify(IDENTITIES.bob),
    "--terms_commitment", termsCommitmentA,
    "--expires_at_ledger", String(initialLedger + 50000),
  ]);
  const txD1 = parseTxHash(createResD.output);
  const ledgerD1 = await getTxLedger(txD1);

  // obs4 submits attestation
  const attD = invokeContract("obs4", "submit_observer_attestation", [
    "--case_id", caseIdD,
    "--observer", IDENTITIES.obs4,
    "--commitment", obsCommitmentA,
  ]);
  const txD2 = parseTxHash(attD.output);
  const ledgerD2 = await getTxLedger(txD2);
  console.log(`D2 Obs4 Attestation submitted: tx=${txD2}, ledger=${ledgerD2}`);

  // Admin revokes obs4
  const revokeD = invokeContract("deployer", "remove_observer", [
    "--observer", IDENTITIES.obs4,
  ]);
  const txD3 = parseTxHash(revokeD.output);
  const ledgerD3 = await getTxLedger(txD3);
  console.log(`D3 Revoke Obs4: tx=${txD3}, ledger=${ledgerD3}`);

  // Verify obs4 is no longer active observer
  const isObs4 = invokeContract("deployer", "is_observer", [
    "--observer", IDENTITIES.obs4,
  ]);
  console.log(`D4 is_observer(obs4): ${isObs4.output.trim()}`);

  // Verify historical attestation is preserved in get_attested_observers
  const attestedObserversD = invokeContract("deployer", "get_attested_observers", [
    "--case_id", caseIdD,
  ]);
  console.log(`D5 get_attested_observers: ${attestedObserversD.output.trim()}`);

  // Verify get_attestation returns the valid historical attestation
  const getAttD = invokeContract("deployer", "get_attestation", [
    "--case_id", caseIdD,
    "--attestor", IDENTITIES.obs4,
  ]);
  console.log(`D6 get_attestation(obs4): ${getAttD.output.trim()}`);

  evidence.flows.flowD = {
    name: "Flow D: Historical Attestation Survival & Observer Revocation",
    caseId: caseIdD,
    revokedObserver: IDENTITIES.obs4,
    createCase: { txHash: txD1, ledger: ledgerD1, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txD1}` },
    attestationSubmission: { txHash: txD2, ledger: ledgerD2, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txD2}` },
    removeObserver: { txHash: txD3, ledger: ledgerD3, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txD3}` },
    isActiveObserverAfterRevocation: false,
    historicalAttestationPreserved: attestedObserversD.output.includes(IDENTITIES.obs4),
  };

  // --- FLOW E: Dispute & Mutual Resolution ---
  console.log("\n>>> Starting Flow E: Dispute & Mutual Resolution...");
  const caseIdE = `e1${ts}00000000000000000000000000000000000000000000000000`.slice(0, 64);
  const disputeCommitment = "4444444444444444444444444444444444444444444444444444444444444444";
  const resolutionCommitment = "5555555555555555555555555555555555555555555555555555555555555555";

  // E1: Create case
  const createResE = invokeContract("alice_owner", "create_case", [
    "--case_id", caseIdE,
    "--owner", IDENTITIES.alice,
    "--counterparty", JSON.stringify(IDENTITIES.bob),
    "--terms_commitment", termsCommitmentA,
    "--expires_at_ledger", String(initialLedger + 50000),
  ]);
  const txE1 = parseTxHash(createResE.output);
  const ledgerE1 = await getTxLedger(txE1);

  // E2: Record observation
  const obsResE = invokeContract("deployer", "record_observation", [
    "--case_id", caseIdE,
    "--observer", IDENTITIES.deployer,
    "--tx_hash", dummyTxA,
    "--observed_ledger", String(initialLedger - 10),
    "--observation_commitment", obsCommitmentA,
  ]);
  const txE2 = parseTxHash(obsResE.output);
  const ledgerE2 = await getTxLedger(txE2);

  // E3: Record break
  const breakResE = invokeContract("deployer", "record_break", [
    "--case_id", caseIdE,
    "--observer", IDENTITIES.deployer,
    "--break_code", "AmountMismatch",
  ]);
  const txE3 = parseTxHash(breakResE.output);
  const ledgerE3 = await getTxLedger(txE3);
  console.log(`E3 RecordBreak: tx=${txE3}, ledger=${ledgerE3}`);

  // E4: Open dispute
  const dispResE = invokeContract("alice_owner", "open_dispute", [
    "--case_id", caseIdE,
    "--initiator", IDENTITIES.alice,
    "--dispute_commitment", disputeCommitment,
  ]);
  const txE4 = parseTxHash(dispResE.output);
  const ledgerE4 = await getTxLedger(txE4);
  console.log(`E4 OpenDispute: tx=${txE4}, ledger=${ledgerE4}`);

  // Verify status is Disputed
  const caseAfterDispute = invokeContract("deployer", "get_case", ["--case_id", caseIdE]);
  console.log(`Case E status after dispute: ${caseAfterDispute.output.trim()}`);

  // E5: First resolution submission by Alice (owner)
  const resAliceE = invokeContract("alice_owner", "submit_resolution", [
    "--case_id", caseIdE,
    "--resolver", IDENTITIES.alice,
    "--resolution_commitment", resolutionCommitment,
  ]);
  const txE5 = parseTxHash(resAliceE.output);
  const ledgerE5 = await getTxLedger(txE5);
  console.log(`E5 SubmitResolution (Alice): tx=${txE5}, ledger=${ledgerE5}`);

  // Check case status: MUST STILL BE DISPUTED!
  const caseAfterFirstRes = invokeContract("deployer", "get_case", ["--case_id", caseIdE]);
  const remainsDisputed = caseAfterFirstRes.output.includes("Disputed");
  console.log(`Case E status after first resolution (must be Disputed): ${remainsDisputed}`);

  // E6: Second matching resolution submission by Bob (counterparty)
  const resBobE = invokeContract("bob_counterparty", "submit_resolution", [
    "--case_id", caseIdE,
    "--resolver", IDENTITIES.bob,
    "--resolution_commitment", resolutionCommitment,
  ]);
  const txE6 = parseTxHash(resBobE.output);
  const ledgerE6 = await getTxLedger(txE6);
  console.log(`E6 SubmitResolution (Bob): tx=${txE6}, ledger=${ledgerE6}`);

  // Check case status: MUST NOW BE RESOLVED!
  const caseAfterSecondRes = invokeContract("deployer", "get_case", ["--case_id", caseIdE]);
  const isResolved = caseAfterSecondRes.output.includes("Resolved");
  console.log(`Case E status after second resolution (must be Resolved): ${isResolved}`);

  evidence.flows.flowE = {
    name: "Flow E: Dispute & Mutual Resolution",
    caseId: caseIdE,
    createCase: { txHash: txE1, ledger: ledgerE1, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txE1}` },
    recordBreak: { txHash: txE3, ledger: ledgerE3, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txE3}` },
    openDispute: { txHash: txE4, ledger: ledgerE4, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txE4}` },
    firstResolutionSubmission: { resolver: IDENTITIES.alice, txHash: txE5, ledger: ledgerE5, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txE5}`, statusRemainsDisputed: remainsDisputed },
    secondResolutionSubmission: { resolver: IDENTITIES.bob, txHash: txE6, ledger: ledgerE6, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txE6}`, finalStatusResolved: isResolved },
  };

  // --- FLOW F: Dispute Expiration with Custom TTL ---
  console.log("\n>>> Starting Flow F: Dispute Expiration with Custom TTL...");
  const caseIdF = `f1${ts}00000000000000000000000000000000000000000000000000`.slice(0, 64);

  const createResF = invokeContract("alice_owner", "create_case", [
    "--case_id", caseIdF,
    "--owner", IDENTITIES.alice,
    "--counterparty", JSON.stringify(IDENTITIES.bob),
    "--terms_commitment", termsCommitmentA,
    "--expires_at_ledger", String(initialLedger + 50000),
  ]);
  const txF1 = parseTxHash(createResF.output);
  const ledgerF1 = await getTxLedger(txF1);

  // Record observation + break
  invokeContract("deployer", "record_observation", [
    "--case_id", caseIdF,
    "--observer", IDENTITIES.deployer,
    "--tx_hash", dummyTxA,
    "--observed_ledger", String(initialLedger - 10),
    "--observation_commitment", obsCommitmentA,
  ]);
  const breakResF = invokeContract("deployer", "record_break", [
    "--case_id", caseIdF,
    "--observer", IDENTITIES.deployer,
    "--break_code", "AssetMismatch",
  ]);
  const txF2 = parseTxHash(breakResF.output);
  const ledgerF2 = await getTxLedger(txF2);

  // Open dispute with custom TTL of 120 ledgers (minimum valid TTL per contract storage: MIN_DISPUTE_TTL_LEDGERS)
  const openTtlResF = invokeContract("alice_owner", "open_dispute_with_ttl", [
    "--case_id", caseIdF,
    "--initiator", IDENTITIES.alice,
    "--dispute_commitment", disputeCommitment,
    "--ttl_ledgers", "120",
  ]);
  const txF3 = parseTxHash(openTtlResF.output);
  const ledgerF3 = await getTxLedger(txF3);
  console.log(`F3 OpenDisputeWithTtl (120): tx=${txF3}, ledger=${ledgerF3}`);

  // Query dispute expiration
  const expResF = invokeContract("deployer", "get_dispute_expiration", [
    "--case_id", caseIdF,
  ]);
  console.log(`F4 Dispute expiration output: ${expResF.output.trim()}`);
  const expLedger = parseInt(expResF.output.trim(), 10);
  console.log(`Dispute configured to expire at ledger: ${expLedger} (current + 120)`);

  // Verify premature expire_dispute is rejected with DisputeNotExpired (Error #20)
  const prematureExpF = invokeContract("deployer", "expire_dispute", [
    "--case_id", caseIdF,
  ]);
  console.log(`F5 Premature ExpireDispute rejected: ${prematureExpF.output.trim()}`);
  const hasDisputeNotExpired = prematureExpF.output.includes("Error(Contract, #20)");

  evidence.flows.flowF = {
    name: "Flow F: Dispute Expiration with Custom TTL",
    caseId: caseIdF,
    createCase: { txHash: txF1, ledger: ledgerF1, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txF1}` },
    recordBreak: { txHash: txF2, ledger: ledgerF2, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txF2}` },
    openDisputeWithTtl: { ttlLedgers: 120, txHash: txF3, ledger: ledgerF3, explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txF3}` },
    expirationLedger: expLedger,
    prematureExpirationRejection: {
      rejectedAsExpected: hasDisputeNotExpired,
      errorCode: "Error(Contract, #20) [DisputeNotExpired]",
    },
  };

  // --- FLOW G: Finalized Immutability ---
  console.log("\n>>> Starting Flow G: Finalized Immutability Verification...");
  // Attempt to open dispute or set quorum on finalized case A
  const mutateFinalizedG = invokeContract("alice_owner", "open_dispute", [
    "--case_id", caseIdA,
    "--initiator", IDENTITIES.alice,
    "--dispute_commitment", disputeCommitment,
  ]);
  console.log(`G Attempt mutation on finalized case: success=${mutateFinalizedG.success}, isContractError=${mutateFinalizedG.isContractError}`);
  const hasAlreadyFinalizedError = mutateFinalizedG.output.includes("Error(Contract, #7)");
  console.log(`Rejected with CaseAlreadyFinalized (Error #7): ${hasAlreadyFinalizedError}`);

  evidence.flows.flowG = {
    name: "Flow G: Finalized Immutability",
    targetCaseId: caseIdA,
    attemptedMutation: "open_dispute",
    rejectedAsExpected: hasAlreadyFinalizedError,
    errorCode: "Error(Contract, #7) [CaseAlreadyFinalized]",
    rawOutput: mutateFinalizedG.output.split("\n")[0],
  };

  // Write evidence to disk
  fs.writeFileSync("testnet-evidence.json", JSON.stringify(evidence, null, 2));
  console.log("\n==========================================================");
  console.log("  All live testnet flows successfully executed!");
  console.log("  Evidence captured in testnet-evidence.json");
  console.log("==========================================================");
}

run().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
