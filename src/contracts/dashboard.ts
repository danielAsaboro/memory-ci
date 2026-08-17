import { z } from "zod";

export const identifierSchema = z.string().uuid();
export const timestampSchema = z.string().datetime({ offset: true });
export const nullableTimestampSchema = timestampSchema.nullable();
export const candidateStateSchema = z.enum([
  "proposed", "screening", "evaluating", "review_required", "approved", "active",
  "quarantined", "rejected", "superseded", "rolled_back", "expired", "failed",
]);
export const memoryClassSchema = z.enum(["policy", "fact", "preference", "episode", "skill", "constraint"]);
export const trustClassSchema = z.enum(["untrusted", "observed", "authenticated", "authoritative"]);
export const evaluationStatusSchema = z.enum(["pending", "running", "passed", "regressed", "inconclusive", "failed"]);
export const evaluationResultStatusSchema = z.enum(["passed", "regressed", "inconclusive", "failed"]);
export const integrationStateSchema = z.enum(["ready", "pending", "blocked", "unavailable"]);

export const integrationSchema = z.object({
  state: integrationStateSchema,
  detail: z.string().min(1).max(500),
}).strict();

export const integrationsSchema = z.object({
  cockroach: integrationSchema,
  aws: integrationSchema,
  agent: integrationSchema,
}).strict();

export const workspaceSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(255),
}).strict();

export const overviewMetricsSchema = z.object({
  agents: z.number().int().nonnegative(),
  activeMemories: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
  auditEvents: z.number().int().nonnegative(),
}).strict();

export const overviewSchema = z.object({
  workspace: workspaceSchema,
  metrics: overviewMetricsSchema,
}).strict();

export const agentSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(255),
  namespaceIds: z.array(identifierSchema),
  reads: z.number().int().nonnegative(),
  lastReadAt: nullableTimestampSchema,
}).strict();

export const memorySummarySchema = z.object({
  id: identifierSchema,
  namespaceId: identifierSchema,
  namespaceName: z.string().min(1).max(255),
  lineageId: identifierSchema,
  stableKey: z.string().min(1).max(255),
  candidateId: identifierSchema,
  memoryClass: memoryClassSchema,
  canonicalText: z.string().max(50_000),
  contentDigest: z.string().min(1).max(128),
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  active: z.boolean(),
  reads: z.number().int().nonnegative(),
  validFrom: timestampSchema,
  validUntil: nullableTimestampSchema,
}).strict();

export const lineageSchema = z.array(memorySummarySchema);

export const memoryDetailSchema = memorySummarySchema.extend({
  lineage: lineageSchema,
}).strict();

export const candidateSummarySchema = z.object({
  id: identifierSchema,
  namespaceId: identifierSchema,
  namespaceName: z.string().min(1).max(255),
  lineageId: identifierSchema.nullable(),
  state: candidateStateSchema,
  memoryClass: memoryClassSchema,
  trustClass: trustClassSchema,
  canonicalText: z.string().max(50_000),
  contentDigest: z.string().min(1).max(128),
  source: z.object({
    id: identifierSchema,
    uri: z.string().max(2_000).nullable(),
    signatureVerified: z.boolean(),
  }).strict(),
  author: z.object({ id: identifierSchema, name: z.string().min(1).max(255) }).strict(),
  findingCount: z.number().int().nonnegative(),
  blockingFindingCount: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export const evaluationSummarySchema = z.object({
  id: identifierSchema,
  candidateId: identifierSchema,
  baselineRevision: z.number().int().nonnegative(),
  policyVersion: z.string().min(1).max(255),
  status: evaluationStatusSchema,
  modelId: z.string().max(255).nullable(),
  providerRequestId: z.string().max(255).nullable(),
  startedAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  resultCount: z.number().int().nonnegative(),
}).strict();

export const evaluationResultSchema = z.object({
  id: identifierSchema,
  scenarioId: identifierSchema,
  scenarioName: z.string().min(1).max(255),
  status: evaluationResultStatusSchema,
  artifactUri: z.string().max(2_000).nullable(),
  providerRequestId: z.string().max(255).nullable(),
  createdAt: timestampSchema,
}).strict();

export const evaluationDetailSchema = evaluationSummarySchema.extend({
  results: z.array(evaluationResultSchema),
}).strict();

export const auditEventSchema = z.object({
  id: identifierSchema,
  actor: z.object({ id: identifierSchema, name: z.string().min(1).max(255) }).strict(),
  action: z.string().min(1).max(255),
  resource: z.object({ type: z.string().min(1).max(255), id: identifierSchema }).strict(),
  requestId: z.string().min(1).max(255),
  providerRequestId: z.string().max(255).nullable(),
  eventDigest: z.string().min(1).max(128),
  previousEventDigest: z.string().max(128).nullable(),
  createdAt: timestampSchema,
}).strict();

export const workspaceStatusSchema = z.object({
  workspace: workspaceSchema,
  namespaceCount: z.number().int().nonnegative(),
  integrations: integrationsSchema,
}).strict();

// Lifecycle responses are deliberately small public receipts.  The mutation
// boundary must not accidentally expose canonical payloads, tenant IDs, or
// provider internals that are available to the service layer.
export const candidateReceiptSchema = z.object({
  id: identifierSchema,
  state: candidateStateSchema,
  contentDigest: z.string().min(1).max(128).optional(),
  provenanceVerified: z.boolean().optional(),
  redactions: z.array(z.string().max(255)).optional(),
}).strict();
export const screeningReceiptSchema = z.object({
  candidateId: identifierSchema,
  state: candidateStateSchema,
  findings: z.array(z.object({ ruleId: z.string().min(1).max(255), severity: z.enum(["low", "medium", "high", "critical"]), message: z.string().min(1).max(2_000) }).strict()),
}).strict();
export const evaluationRequestSchema = z.object({ candidateId: identifierSchema, status: z.literal("queued"), eventId: identifierSchema }).strict();
export const reviewReceiptSchema = z.object({
  reviewId: identifierSchema, candidateId: identifierSchema, decision: z.enum(["approved", "rejected", "quarantined"]),
  evaluationRunId: identifierSchema, baselineRevision: z.number().int().nonnegative(), policyVersion: z.string().min(1).max(255),
}).strict();
export const memoryMutationReceiptSchema = z.object({
  memoryVersionId: identifierSchema, lineageId: identifierSchema, candidateId: identifierSchema,
  revision: z.number().int().positive(), version: z.number().int().positive(), active: z.boolean(),
}).strict();

export type Identifier = z.infer<typeof identifierSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type CandidateState = z.infer<typeof candidateStateSchema>;
export type MemoryClass = z.infer<typeof memoryClassSchema>;
export type TrustClass = z.infer<typeof trustClassSchema>;
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;
export type EvaluationResultStatus = z.infer<typeof evaluationResultStatusSchema>;
export type IntegrationState = z.infer<typeof integrationStateSchema>;
export type Integration = z.infer<typeof integrationSchema>;
export type Integrations = z.infer<typeof integrationsSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type OverviewMetrics = z.infer<typeof overviewMetricsSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type MemorySummary = z.infer<typeof memorySummarySchema>;
export type Lineage = z.infer<typeof lineageSchema>;
export type MemoryDetail = z.infer<typeof memoryDetailSchema>;
export type CandidateSummary = z.infer<typeof candidateSummarySchema>;
export type EvaluationSummary = z.infer<typeof evaluationSummarySchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type EvaluationDetail = z.infer<typeof evaluationDetailSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export type CandidateReceipt = z.infer<typeof candidateReceiptSchema>;
export type ScreeningReceipt = z.infer<typeof screeningReceiptSchema>;
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;
export type ReviewReceipt = z.infer<typeof reviewReceiptSchema>;
export type MemoryMutationReceipt = z.infer<typeof memoryMutationReceiptSchema>;
