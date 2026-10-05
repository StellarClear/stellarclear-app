import { z } from "zod";
import { Bytes32HexSchema, StellarAddressSchema } from "./primitives.js";
import { CaseStatusSchema } from "./enums.js";
import {
  ExpectedSettlementSchema,
  ObservedSettlementSchema,
} from "./settlement.js";
import { BreakSchema, ReconciliationResultSchema } from "./reconciliation.js";
import { SettlementProofSchema } from "./proof.js";

/**
 * Request payload for creating a new settlement case.
 */
export const CreateCaseRequestSchema = z.object({
  expected: ExpectedSettlementSchema,
  observerQuorum: z.number().int().positive().optional(),
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequestSchema>;

/**
 * Response payload after creating a settlement case.
 */
export const CreateCaseResponseSchema = z.object({
  caseId: Bytes32HexSchema,
  status: CaseStatusSchema,
  termsCommitment: Bytes32HexSchema,
  txHash: z.string().optional(),
  createdAt: z.string().min(1),
});
export type CreateCaseResponse = z.infer<typeof CreateCaseResponseSchema>;

/**
 * Request payload for recording an observed settlement.
 */
export const SubmitObservationRequestSchema = z.object({
  observation: ObservedSettlementSchema,
});
export type SubmitObservationRequest = z.infer<typeof SubmitObservationRequestSchema>;

/**
 * Request payload for verifying a settlement proof.
 */
export const VerifyProofRequestSchema = z.object({
  proof: SettlementProofSchema,
  termsDocument: ExpectedSettlementSchema.optional(),
  observedDocument: ObservedSettlementSchema.optional(),
});
export type VerifyProofRequest = z.infer<typeof VerifyProofRequestSchema>;

/**
 * Response payload for proof verification.
 */
export const VerifyProofResponseSchema = z.object({
  valid: z.boolean(),
  reason: z.string().optional(),
  recomputedTermsCommitment: Bytes32HexSchema.optional(),
  recomputedObservationCommitment: Bytes32HexSchema.optional(),
  verifiedAt: z.string().min(1),
});
export type VerifyProofResponse = z.infer<typeof VerifyProofResponseSchema>;

/**
 * Standard API Error Envelope.
 */
export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/**
 * Health & Readiness Response.
 */
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  timestamp: z.string().min(1),
  version: z.string().min(1),
  services: z
    .record(
      z.string(),
      z.object({
        status: z.enum(["up", "down", "unknown"]),
        message: z.string().optional(),
      })
    )
    .optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
