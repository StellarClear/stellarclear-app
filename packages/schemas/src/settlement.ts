import { z } from "zod";
import {
  Bytes32HexSchema,
  DecimalAmountSchema,
  LedgerSequenceSchema,
  StellarAddressSchema,
} from "./primitives.js";
import { TransactionStatusSchema } from "./enums.js";

/**
 * Expected Settlement instruction submitted by case owner.
 * Contains private business details that are canonically hashed before on-chain commitment.
 */
export const ExpectedSettlementSchema = z.object({
  caseId: Bytes32HexSchema,
  tradeReference: z.string().min(1, "tradeReference cannot be empty").max(128),
  asset: z.string().min(1, "asset cannot be empty").max(128),
  amount: DecimalAmountSchema,
  expectedDestination: StellarAddressSchema,
  reference: z.string().max(128).optional(),
  deadline: LedgerSequenceSchema,
  owner: StellarAddressSchema,
  counterparty: StellarAddressSchema.optional(),
  observerQuorum: z.number().int().positive().optional(),
});

export type ExpectedSettlement = z.infer<typeof ExpectedSettlementSchema>;

/**
 * Observed Settlement transaction detected on the Stellar ledger by an observer.
 */
export const ObservedSettlementSchema = z.object({
  txHash: Bytes32HexSchema,
  ledger: LedgerSequenceSchema,
  asset: z.string().min(1, "asset cannot be empty").max(128),
  amount: DecimalAmountSchema,
  destination: StellarAddressSchema,
  reference: z.string().max(128).optional(),
  status: TransactionStatusSchema.default("SUCCESS"),
  observedAt: z.string().min(1, "observedAt timestamp is required"),
});

export type ObservedSettlement = z.infer<typeof ObservedSettlementSchema>;
