import type { TenantTransaction } from "../db/client";
import { DomainError } from "../domain/errors";

export type EvaluationScenario = Readonly<{
  id: string; namespaceId: string; name: string; inputPayload: Readonly<Record<string, unknown>>;
  assertions: Readonly<Record<string, unknown>>; expectedToolConstraints: Readonly<Record<string, unknown>>;
  distance: number;
}>;

export async function selectScenarios(
  transaction: TenantTransaction,
  candidateId: string,
  limit: number,
): Promise<EvaluationScenario[]> {
  const candidate = await transaction.client.query<{ namespace_id: string; embedding: string | null }>(
    "SELECT namespace_id,embedding FROM memory_candidates WHERE tenant_id=$1 AND id=$2",
    [transaction.tenantId, candidateId],
  );
  const row = candidate.rows[0];
  if (!row) throw new DomainError("not_found", "Candidate was not found.");
  if (!row.embedding) throw new DomainError("invalid_input", "Candidate embedding is required for scenario selection.");
  const result = await transaction.client.query<{
    id: string; namespace_id: string; name: string; input_payload: Record<string, unknown>;
    assertions: Record<string, unknown>; expected_tool_constraints: Record<string, unknown>; distance: string;
  }>(
    `SELECT id,namespace_id,name,input_payload,assertions,expected_tool_constraints,
            embedding <=> $3::VECTOR AS distance
     FROM evaluation_scenarios
     WHERE tenant_id=$1 AND namespace_id=$2 AND active
     ORDER BY embedding <=> $3::VECTOR
     LIMIT $4`,
    [transaction.tenantId, row.namespace_id, row.embedding, limit],
  );
  return result.rows.map((scenario) => ({
    id: scenario.id, namespaceId: scenario.namespace_id, name: scenario.name,
    inputPayload: scenario.input_payload, assertions: scenario.assertions,
    expectedToolConstraints: scenario.expected_tool_constraints, distance: Number(scenario.distance),
  }));
}
