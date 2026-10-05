# Settlement Lifecycle & State Machine

Every settlement tracked by StellarClear progresses through a deterministic, strictly enforced 7-state finite state machine.

## Settlement State Machine

```text
         ┌───────────────┐
         │     OPEN      │  (Expected terms registered & anchored on-chain)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │   OBSERVED    │  (Payment observed on Stellar ledger)
         └───────┬───────┘
                 │
        Reconciliation Check
        ┌────────┴────────┐
        ▼                 ▼
 ┌─────────────┐   ┌─────────────┐
 │   MATCHED   │   │    BREAK    │  (Classified with BreakCode)
 └──────┬──────┘   └──────┬──────┘
        │                 │
        │                 ▼
        │          ┌─────────────┐
        │          │  DISPUTED   │◄───────┐
        │          └──────┬──────┘        │ (Single resolution /
        │                 │               │  remains DISPUTED)
        │       ┌─────────┴─────────┐     │
        │       │ (Mutual Agreement)│     │
        │       ▼                   ▼     │
        │ ┌─────────────┐    (TTL Expired)│
        │ │  RESOLVED   │    ──► BREAK ───┘
        │ └──────┬──────┘
        │        │
        └────────┼────────┐
                 ▼        │ (Enforces Observer Quorum)
         ┌───────────────┐│
         │   FINALIZED   │◄
         └───────────────┘
```

## Lifecycle States Defined

| State | Tag | Description | Allowed Next States |
| :--- | :--- | :--- | :--- |
| **`OPEN`** | `Open` | Bilateral terms registered by case owner; `termsCommitment` anchored on Soroban. | `OBSERVED` |
| **`OBSERVED`** | `Observed` | Payment transaction observed on Stellar ledger; `observationCommitment` anchored on Soroban. | `MATCHED`, `BREAK` |
| **`MATCHED`** | `Matched` | Matcher verifies exact alignment between expected terms and observed transaction. | `FINALIZED` (Observer Quorum satisfied) |
| **`BREAK`** | `Break` | Matcher detects a parameter variance and assigns a standardized `BreakCode`. | `DISPUTED` |
| **`DISPUTED`** | `Disputed` | Case owner or counterparty contests a break. Single resolution keeps case DISPUTED. | `RESOLVED` (Mutual agreement), `BREAK` (TTL Expired) |
| **`RESOLVED`** | `Resolved` | Both parties submit matching `resolutionCommitment` terms on-chain. | `FINALIZED` (Observer Quorum satisfied) |
| **`FINALIZED`** | `Finalized` | Settlement is immutably sealed on Soroban once observer quorum is met. | *Terminal State* |

## Worked Numerical Example

### Scenario
- **Owner (Company A)**: `GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5SLQ`
- **Counterparty (Company B)**: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
- **Agreed Asset**: `EURC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- **Agreed Amount**: `1000.0000000` EURC
- **Deadline**: Ledger `2000000`

### Step-by-Step Flow

1. **Case Creation (`OPEN`)**:
   - Company A generates deterministic `caseId` = `1212...1212`.
   - Computes `termsCommitment` = `a1b2c3d4e5f6...`.
   - Invokes `create_case` on Soroban contract. Case status is `OPEN`.
2. **Payment Observation (`OBSERVED`)**:
   - Company A executes a Stellar payment transfer of `1000.0000000` EURC to Company B (`txHash` = `3434...3434`, ledger = `1995000`).
   - Observer records payment details, computing `observationCommitment` = `f0e1d2c3b4a5...`.
   - Invokes `record_observation`. Case status transitions to `OBSERVED`.
3. **Reconciliation Match (`MATCHED`)**:
   - Matcher compares amount (`1000.0000000` == `1000.0000000`), asset, destination, and ledger deadline (`1995000` <= `2000000`).
   - Matcher issues decision `MATCHED`.
   - Observer invokes `record_match`. Case status transitions to `MATCHED`.
4. **Attestation & Settlement Proof**:
   - Company A and Company B submit cryptographic signatures (`submit_attestation`).
   - Self-contained `SettlementProof` bundle is assembled.
5. **Finalization (`FINALIZED`)**:
   - Case owner invokes `finalize_case` on Soroban.
   - Status transitions to `FINALIZED` at ledger `1995100`. The case is immutably sealed.
