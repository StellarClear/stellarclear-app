# Contributing to StellarClear

Thanks for contributing — all contributors welcome.

## Quick start

```bash
# Clean install reproducible dependencies
npm ci

# Build all workspace packages and services
npm run build

# Run the complete test suite
npm test
```

Node `>=22.12.0`, npm `>=10.0.0`.

To regenerate Soroban bindings you need a `settlement_registry.wasm` build from
[`stellarclear-contract`](https://github.com/StellarClear/stellarclear-contract):

```bash
SETTLEMENT_REGISTRY_WASM=/path/to/settlement_registry.wasm npm run generate:bindings
```

Copy `.env.example` to `.env` and set `STELLAR_CONTRACT_ID` to your testnet deployment.

## Commit Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification for all git commit messages and pull request titles:

- `feat:` for new user-facing features or capabilities
- `fix:` for bug fixes and error resolution
- `docs:` for documentation additions and updates
- `test:` for test additions, unit tests, and regression tests
- `chore:` for maintenance, dependency updates, and repository housekeeping
- `refactor:` for code improvements that do not alter external behavior

Example: `feat(api): add settlement dispute submission route`

## Drips Wave Contribution Guidelines

StellarClear participates in the [Drips Wave](https://www.drips.network/wave) sprint program for the Stellar ecosystem. Community contributors can claim open tasks tagged with `drips-wave` and earn rewards from the program reward pool.

### Point Tiers
- **100 Points (Trivial / Low)**: Documentation additions, UI polishing, test expansions, and schema refinements.
- **150 Points (Medium)**: New API endpoints, matcher reconciliation rules, SDK helper methods, and telemetry integration.
- **200 Points (High / Complex)**: Complex Soroban RPC event stream optimizations, multi-party quorum verifiers, and cryptographic proof extensions.

### How to Pick Up a Drips Wave Task
1. Browse open issues with the [`drips-wave`](https://github.com/StellarClear/stellarclear-app/labels/drips-wave) label.
2. Complete KYC and sign in on [drips.network/wave](https://www.drips.network/wave).
3. Apply for the issue directly through the Drips Wave app.
4. Once assigned by a maintainer, implement your changes in a branch off `main`.
5. Run the full verification suite before pushing:
   ```bash
   npm run build
   npm run typecheck
   npm test
   npm run verify:release
   ```
6. Open a pull request linking your issue: `Fixes #<issue-number>`.
7. Once reviewed and merged by maintainers, Drips Wave will attribute points to your account for payout at the end of the sprint cycle.

## How to pick up an issue

- Look for `good first issue` / `help wanted` labels.
- Comment to request assignment before starting work.
- Keep PRs focused; one issue per PR.
- Add/extend tests under `tests/` for behavior changes.
- Run `npm run build && npm test && npm run verify:release` before pushing.

## Verification & Pre-flight Checks

Before opening a pull request, run the local verification gates:

```bash
# Typecheck all workspaces
npm run typecheck

# Execute unit, api, security, indexer, and integration test suites
npm test

# Run full pre-release verification pipeline
npm run verify:release
```

## PR checklist

- [ ] Linked issue with scope and acceptance criteria
- [ ] Tests added or updated, all green (`npm test`)
- [ ] TypeScript typecheck clean (`npm run typecheck`)
- [ ] Pre-release verification gates passing (`npm run verify:release`)
- [ ] Conventional Commit format used for commit messages and PR title
- [ ] No secrets committed (`.env` stays local, never commit real keys)
- [ ] Apache-2.0 applies — all contributions under same license

## Code of conduct

Be respectful and constructive. See `CODE_OF_CONDUCT.md`.
