# StellarClear Deployment Guide

This guide covers deployment procedures for StellarClear across development, staging (Testnet), and production environments.

---

## 1. Prerequisites & System Requirements

- **Node.js**: `>=22.12.0`
- **npm**: `>=10.0.0`
- **PostgreSQL**: `>=15.0`
- **Stellar CLI**: `@stellar/cli` or standalone binary
- **Rust Toolchain**: `stable` with `wasm32v1-none` target (for contract compilation)

---

## 2. Environment Configuration

StellarClear services and packages are configured via standard environment variables. Create a `.env` file based on `.env.example`:

```bash
# Network & Stellar Configuration
STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
STELLAR_RPC_URL="https://soroban-testnet.stellar.org"
STELLAR_CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"

# Off-Chain Persistence
DATABASE_URL="postgres://stellarclear:stellarclear@localhost:5432/stellarclear_db"

# API & Gateway Ports
API_PORT=3000
API_HOST="0.0.0.0"

# Observer Credentials (for signing on-chain anchors)
OBSERVER_SECRET_KEY="SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

---

## 3. Soroban Smart Contract Deployment

1. **Compile the SettlementRegistry Contract**:
   From the contract repository (`stellarclear-contract`):
   ```bash
   stellar contract build
   ```

2. **Deploy the WASM to Stellar**:
   ```bash
   stellar contract deploy \
     --wasm target/wasm32v1-none/release/settlement_registry.wasm \
     --source <DEPLOYER_SECRET_OR_IDENTITY> \
     --network testnet
   ```
   Save the returned Contract ID (e.g. `CAAA...`).

3. **Initialize the Contract**:
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source <DEPLOYER_SECRET_OR_IDENTITY> \
     --network testnet \
     -- __constructor \
     --admin <ADMIN_PUBLIC_KEY>
   ```

4. **Authorize Observers**:
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --source <ADMIN_SECRET_OR_IDENTITY> \
     --network testnet \
     -- add_observer \
     --observer <OBSERVER_PUBLIC_KEY>
   ```

5. **Generate TypeScript Monorepo Bindings**:
   In `stellarclear-app` monorepo root:
   ```bash
   SETTLEMENT_REGISTRY_WASM=/path/to/settlement_registry.wasm npm run generate:bindings
   ```

---

## 4. Database Setup & Migrations

StellarClear uses PostgreSQL for off-chain indexed data and private settlement metadata.

1. **Initialize Database**:
   ```bash
   createdb stellarclear_db
   ```

2. **Apply Schema Migrations**:
   The database schema is defined in `@stellarclear/db`. Tables created include:
   - `settlement_cases`
   - `settlement_observations`
   - `reconciliation_results`
   - `breaks`
   - `contract_events`
   - `attestations`
   - `disputes`
   - `resolutions`
   - `ingestion_cursors`
   - `idempotency_records`

---

## 5. Running Monorepo Services

### API Service
```bash
# Using root workspace script
npm run start:api

# Or directly in workspace
npm run start --workspace=@stellarclear/api
```

### Ingestion Indexer Service
```bash
# Using root workspace script
npm run start:indexer

# Or directly in workspace
npm run start --workspace=@stellarclear/indexer
```

---

## 6. Docker & Container Deployment

StellarClear includes a multi-stage `Dockerfile` and a multi-service `docker-compose.yml` topology defining `postgres`, `indexer`, and `api` services:

### Dockerfile
```dockerfile
# Multi-stage Docker build for StellarClear services
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests and TypeScript configurations
COPY package*.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY services/ ./services/

# Install dependencies and compile all packages & services
RUN npm ci
RUN npm run build

# Production runner stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy compiled artifacts, node_modules, and manifests from builder
COPY --from=builder /app ./

# Default exposed port for API service
EXPOSE 3000

# Default command starts the REST API service
CMD ["node", "services/api/dist/main.js"]
```

### Docker Compose
To run the full stack (Postgres + Indexer Worker + REST API):
```bash
docker compose up -d
```

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-stellarclear}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-stellarclear_secret}
      POSTGRES_DB: ${POSTGRES_DB:-stellarclear_db}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-stellarclear} -d ${POSTGRES_DB:-stellarclear_db}"]
      interval: 5s
      timeout: 5s
      retries: 5

  indexer:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    command: ["node", "services/indexer/dist/main.js"]
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER:-stellarclear}:${POSTGRES_PASSWORD:-stellarclear_secret}@postgres:5432/${POSTGRES_DB:-stellarclear_db}
      - STELLAR_NETWORK=${STELLAR_NETWORK:-testnet}
      - STELLAR_NETWORK_PASSPHRASE=${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}
      - STELLAR_RPC_URL=${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}
      - STELLAR_CONTRACT_ID=${STELLAR_CONTRACT_ID:-CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5}
    depends_on:
      postgres:
        condition: service_healthy

  api:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    command: ["node", "services/api/dist/main.js"]
    ports:
      - "${API_PORT:-3000}:3000"
    environment:
      - API_PORT=3000
      - API_HOST=0.0.0.0
      - DATABASE_URL=postgresql://${POSTGRES_USER:-stellarclear}:${POSTGRES_PASSWORD:-stellarclear_secret}@postgres:5432/${POSTGRES_DB:-stellarclear_db}
      - STELLAR_NETWORK=${STELLAR_NETWORK:-testnet}
      - STELLAR_NETWORK_PASSPHRASE=${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}
      - STELLAR_RPC_URL=${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}
      - STELLAR_CONTRACT_ID=${STELLAR_CONTRACT_ID:-CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5}
      - ENABLE_ANCHORING=${ENABLE_ANCHORING:-false}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "node -e 'import(\"http\").then(h => h.get(\"http://localhost:3000/health\", res => process.exit(res.statusCode === 200 ? 0 : 1))).catch(() => process.exit(1))'"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  pgdata:
```

---

## 7. Release Candidate Promotion & Verification

Before promoting builds to production staging or mainnet:
1. Follow the verification gates in [Release Candidate Runbook](./release-candidate-runbook.md).
2. Execute `npm run verify:release`.
3. Inspect operational diagnostics at `GET /v1/operations/diagnostics`.
