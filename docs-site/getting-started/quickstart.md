# Quick Start Guide

This guide walks you through setting up and running StellarClear locally in under 5 minutes.

## Prerequisites

- **Node.js**: `>=22.12.0`
- **npm**: `>=10.0.0`
- **Docker & Docker Compose**: (Optional, for running full containerized stack)

## 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/StellarClear/stellarclear-app.git
cd stellarclear-app

# Clean install reproducible dependencies
npm ci

# Build all monorepo workspaces
npm run build
```

## 2. Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

The default `.env` is pre-configured to connect to the Stellar Testnet:

```ini
# Stellar Network & Soroban Configuration
STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
STELLAR_RPC_URL="https://soroban-testnet.stellar.org"
STELLAR_CONTRACT_ID="CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5"

# Database Configuration
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stellarclear_db"

# API Service
API_PORT=3000
API_HOST="0.0.0.0"
ENABLE_ANCHORING=false
```

## 3. Running Services

### Option A: Run via Docker Compose (Recommended)

To launch the full stack (PostgreSQL + Streaming Indexer + REST API):

```bash
docker compose up -d
```

Verify service health:
```bash
curl http://localhost:3000/health
```

### Option B: Run Monorepo Services Directly

```bash
# Terminal 1: Run REST API
npm run start:api

# Terminal 2: Run Streaming Indexer Worker
npm run start:indexer
```

## 4. Run the Verification Suite

Run all unit, API, indexer, security, and Soroban integration test suites:

```bash
# Execute the complete test suite (196 tests across 58 suites)
npm test

# Run modular test suites
npm run test:unit         # Schemas, proof, matcher, db, sdk
npm run test:api          # REST endpoints & operational probes
npm run test:security     # Replay protection & adversarial regression
npm run test:indexer      # Event ingestion & cursor sync
npm run test:integration  # End-to-end Soroban contract lifecycles

# Execute full 8-stage pre-flight release check
npm run verify:release
```
