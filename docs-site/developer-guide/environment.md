# Environment & Configuration

StellarClear services and packages are configured using standard environment variables.

## Environment Variable Reference

| Variable | Target Component | Required / Optional | Default (Local / Testnet) | Description |
| :--- | :--- | :--- | :--- | :--- |
| `STELLAR_NETWORK` | API, Indexer, SDK | Optional | `testnet` | Target Stellar network identifier (`testnet`, `mainnet`, `futurenet`, `standalone`). |
| `STELLAR_NETWORK_PASSPHRASE` | API, Indexer, SDK | Optional | `Test SDF Network ; September 2015` | Authoritative network passphrase used for signing and transaction envelope validation. |
| `STELLAR_RPC_URL` | API, Indexer, SDK | Optional | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint URL. |
| `STELLAR_CONTRACT_ID` | API, Indexer, SDK | **Required** | `CCPCMPIUTKBLSJVSGPPSUHTBBY6HHT3OTE3CKUXC5BD2B3YEDSAROGC5` | 56-character StrKey contract ID (`C...`) for deployed `SettlementRegistry`. |
| `DATABASE_URL` | API, Indexer, DB | **Required** | `postgresql://postgres:postgres@localhost:5432/stellarclear_db` | PostgreSQL connection string. |
| `API_PORT` | API Service | Optional | `3000` | Port for the REST API HTTP server. |
| `API_HOST` | API Service | Optional | `0.0.0.0` | Host IP address to bind API HTTP server. |
| `ENABLE_ANCHORING` | API Service | Optional | `false` | When `true`, API automatically submits state transitions on-chain using observer key. |
| `INDEXER_POLL_INTERVAL_MS`| Indexer Service | Optional | `5000` | Polling interval in milliseconds for fetching new contract events from RPC. |
| `INDEXER_BATCH_SIZE` | Indexer Service | Optional | `100` | Maximum number of events to ingest in a single RPC query batch. |

## Production Configuration Safety Rules

When running in production (`STELLAR_NETWORK=mainnet`):
1. **Contract ID**: Must be an explicit deployed mainnet contract address. Default placeholder addresses are rejected by configuration validators.
2. **Network Passphrase**: Must match `Public Global Stellar Network ; September 2015`.
3. **Database URL**: Must use private networking with TLS enabled.
