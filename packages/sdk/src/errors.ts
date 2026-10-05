export class StellarClearError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code = "STELLARCLEAR_ERROR", details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends StellarClearError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", details);
  }
}

export class NotFoundError extends StellarClearError {
  constructor(message: string, details?: unknown) {
    super(message, "NOT_FOUND", details);
  }
}

export class ConflictError extends StellarClearError {
  constructor(message: string, details?: unknown) {
    super(message, "CONFLICT", details);
  }
}

export class UnauthorizedError extends StellarClearError {
  constructor(message: string, details?: unknown) {
    super(message, "UNAUTHORIZED", details);
  }
}

export class ContractInvocationError extends StellarClearError {
  public readonly contractErrorCode?: number;

  constructor(message: string, contractErrorCode?: number, details?: unknown) {
    super(message, "CONTRACT_INVOCATION_ERROR", details);
    this.contractErrorCode = contractErrorCode;
  }
}

export class RpcError extends StellarClearError {
  constructor(message: string, details?: unknown) {
    super(message, "RPC_ERROR", details);
  }
}

export class MissingTransactionHashError extends StellarClearError {
  constructor(message?: string, details?: unknown) {
    super(
      message ??
        "SDK_MISSING_TX_HASH: Soroban transaction response did not include a real transaction hash. " +
        "The operation cannot be recorded as settlement evidence without a verifiable on-chain identifier.",
      "MISSING_TRANSACTION_HASH",
      details
    );
  }
}

/**
 * Maps numeric contract error codes (1..21) to specific domain errors.
 */
export function mapContractErrorCode(code: number, rawMessage?: string): StellarClearError {
  switch (code) {
    case 1:
      return new ConflictError(rawMessage ?? "Contract already initialized");
    case 2:
      return new NotFoundError(rawMessage ?? "Record not found");
    case 3:
      return new ConflictError(rawMessage ?? "Case already exists");
    case 4:
      return new ConflictError(rawMessage ?? "Observer already registered");
    case 5:
      return new NotFoundError(rawMessage ?? "Observer not registered");
    case 6:
      return new UnauthorizedError(rawMessage ?? "Unauthorized caller");
    case 7:
      return new ValidationError(rawMessage ?? "Invalid case state for operation");
    case 8:
      return new ValidationError(rawMessage ?? "Invalid expiration ledger");
    case 9:
      return new ValidationError(rawMessage ?? "Invalid zero commitment");
    case 10:
      return new ValidationError(rawMessage ?? "Counterparty required for this operation");
    case 11:
      return new ValidationError(rawMessage ?? "Counterparty cannot be owner");
    case 12:
      return new ConflictError(rawMessage ?? "Attestation already exists for this case and party");
    case 13:
      return new ConflictError(rawMessage ?? "Resolution already submitted by this party");
    case 14:
      return new ValidationError(rawMessage ?? "Resolution commitments do not match");
    case 15:
      return new ValidationError(rawMessage ?? "Missing required attestation for finalization");
    case 16:
      return new ValidationError(rawMessage ?? "Invalid decision for current state");
    case 17:
      return new ValidationError(rawMessage ?? "Invalid ledger sequence");
    case 18:
      return new ValidationError(rawMessage ?? "Invalid observer quorum");
    case 19:
      return new ValidationError(rawMessage ?? "Required observer quorum threshold was not met");
    case 20:
      return new ValidationError(rawMessage ?? "Dispute has not yet expired");
    case 21:
      return new ValidationError(rawMessage ?? "Dispute has already expired");
    default:
      return new ContractInvocationError(rawMessage ?? `Contract error code: ${code}`, code);
  }
}

/**
 * Normalizes any error thrown during contract interaction into a typed StellarClearError.
 */
export function normalizeContractError(err: unknown): StellarClearError {
  if (err instanceof StellarClearError) {
    return err;
  }

  if (typeof err === "object" && err !== null) {
    const errorObj = err as Record<string, unknown>;

    // Soroban contract error with code
    if (typeof errorObj.code === "number" && errorObj.code >= 1 && errorObj.code <= 21) {
      return mapContractErrorCode(errorObj.code, errorObj.message as string | undefined);
    }

    // Soroban error with nested simulation error
    const msg = String(errorObj.message ?? errorObj.detail ?? "");
    for (let i = 1; i <= 21; i++) {
      if (msg.includes(`Error(Contract, #${i})`) || msg.includes(`code ${i}`)) {
        return mapContractErrorCode(i, msg);
      }
    }

    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("RPC")) {
      return new RpcError(`RPC communication failed: ${msg}`, err);
    }

    return new StellarClearError(msg || "Unknown contract interaction failure", "UNKNOWN_CONTRACT_ERROR", err);
  }

  return new StellarClearError(String(err), "UNKNOWN_ERROR");
}
