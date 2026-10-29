# Drips Wave — Stellar Ecosystem Contribution Sprints

Welcome to the **StellarClear Drips Wave Contributor Hub**! StellarClear is an active open-source project participating in [Drips Wave](https://www.drips.network/wave) in partnership with the Stellar Development Foundation.

Through Drips Wave, developers from around the world can solve curated issues, submit pull requests, and earn points from the community reward pool.

---

## What is StellarClear?

StellarClear is a non-custodial settlement evidence and reconciliation protocol built natively on Stellar and Soroban. It solves institutional friction in cross-border payments:
1. **Off-Chain Matcher**: Deterministically reconciles trade expectations against Stellar ledger transactions using decimal-exact math.
2. **Cryptographic Proofs**: Computes RFC 8785 canonical JSON commitments and SHA-256 hashes for settlement terms.
3. **Soroban Smart Contract**: Anchors observer attestations, dispute workflows, and final settlement records immutably on-chain (`SettlementRegistry`).

StellarClear **never** custodies participant funds — token transfers occur directly between counterparties on Stellar.

---

## Reward Point Tiers

Every sprint task is categorized by complexity and impact:

| Tier | Points | Scope & Examples |
| :--- | :---: | :--- |
| **Trivial / Low** | **100 pts** | Documentation guides, VitePress layout polish, test suite expansion, schema validations, and typo fixes. |
| **Medium** | **150 pts** | New API endpoints, deterministic matcher rules, TypeScript SDK client methods, Prometheus metric collectors, and error normalization. |
| **High / Complex** | **200 pts** | Resilient Soroban RPC streaming indexer recovery, multi-party observer quorum cryptographic verification, dispute TTL automata, and Soroban contract invariant tests. |

---

## 5-Step Contributor Workflow

### Step 1: Browse Open Sprint Issues
Explore active sprint issues tagged with [`drips-wave`](https://github.com/StellarClear/stellarclear-app/issues?q=is%3Aissue+is%3Aopen+label%3Adrips-wave):
- [stellarclear-app Sprint Backlog](https://github.com/StellarClear/stellarclear-app/issues?q=is%3Aissue+is%3Aopen+label%3Adrips-wave)
- [stellarclear-contract Sprint Backlog](https://github.com/StellarClear/stellarclear-contract/issues?q=is%3Aissue+is%3Aopen+label%3Adrips-wave)

### Step 2: Register & Claim on Drips Wave
1. Visit [www.drips.network/wave](https://www.drips.network/wave) and sign in with your GitHub account.
2. Complete the standard one-time KYC verification via Sumsub.
3. Navigate to **StellarClear** under the Stellar Ecosystem Wave.
4. Click **Apply** on the issue you wish to claim. A maintainer will assign you.

### Step 3: Local Setup & Development
Clone the repository and install dependencies:

```bash
git clone https://github.com/StellarClear/stellarclear-app.git
cd stellarclear-app

# Clean install reproducible dependencies
npm ci

# Build all monorepo packages
npm run build

# Run local test suite
npm test
```

### Step 4: Verification Gates
Before opening a pull request, ensure all quality gates are green:

```bash
# Typecheck all workspaces and test suites
npm run typecheck

# Run unit, API, indexer, and security test suites
npm test

# Full pre-release verification pipeline
npm run verify:release
```

### Step 5: Submit Pull Request
1. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/):
   ```text
   feat(api): add settlement dispute resolution status endpoint
   ```
2. Open a Pull Request on GitHub and link the issue in the body:
   ```text
   Fixes #<issue-number>
   ```
3. Once reviewed and merged into `main`, Drips Wave registers your completed task and allocates points to your wallet address for the sprint payout!

---

## Testnet Resources

| Resource | Value / Link |
| :--- | :--- |
| **Active Contract ID** | [`CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5`](https://stellar.expert/explorer/testnet/contract/CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5) |
| **Soroban RPC Endpoint** | `https://soroban-testnet.stellar.org` |
| **Network Passphrase** | `Test SDF Network ; September 2015` |
| **Interactive Protocol Dashboard** | [Live Browser Console](/dashboard) |
| **Stellar Testnet Friendbot** | [Stellar Laboratory Faucet](https://laboratory.stellar.org/#account-creator?network=test) |

---

## Questions & Assistance

Join our community channels or post on GitHub Discussions:
- [GitHub Discussions](https://github.com/StellarClear/stellarclear-app/discussions)
- [Stellar Developer Discord](https://discord.gg/stellardev)
