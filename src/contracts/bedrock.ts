import { z } from "zod";

export const modelFindingSchema = z.object({
  ruleId: z.string().min(1).max(100),
  severity: z.enum(["low", "medium", "high", "critical"]),
  message: z.string().min(1).max(500),
  safeEvidence: z.string().max(500),
}).strict();

export const modelScreeningSchema = z.object({
  summary: z.string().min(1).max(1_000),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  findings: z.array(modelFindingSchema).max(20),
}).strict();

export const semanticEvaluationSchema = z.object({
  status: z.enum(["passed", "regressed", "inconclusive"]),
  reason: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
}).strict();

export type ModelScreeningResult = z.infer<typeof modelScreeningSchema>;
export type SemanticEvaluation = z.infer<typeof semanticEvaluationSchema>;
