export const candidateStates = [
  "proposed",
  "screening",
  "evaluating",
  "review_required",
  "approved",
  "active",
  "quarantined",
  "rejected",
  "superseded",
  "rolled_back",
  "expired",
  "failed",
] as const;

export type CandidateState = (typeof candidateStates)[number];

export const memoryClasses = ["policy", "fact", "preference", "episode", "skill", "constraint"] as const;
export type MemoryClass = (typeof memoryClasses)[number];

export const trustClasses = ["untrusted", "observed", "authenticated", "authoritative"] as const;
export type TrustClass = (typeof trustClasses)[number];

export type TenantContext = Readonly<{
  tenantId: string;
  principalId: string;
  requestId: string;
}>;

export type Candidate = Readonly<{
  id: string;
  tenantId: string;
  namespaceId: string;
  lineageId: string | null;
  state: CandidateState;
  memoryClass: MemoryClass;
  trustClass: TrustClass;
  canonicalPayload: Readonly<Record<string, unknown>>;
  contentDigest: string;
  sourceId: string;
  createdBy: string;
  createdAt: Date;
}>;

export type MemoryVersion = Readonly<{
  id: string;
  tenantId: string;
  namespaceId: string;
  lineageId: string;
  candidateId: string;
  version: number;
  revision: number;
  active: boolean;
  canonicalPayload: Readonly<Record<string, unknown>>;
  contentDigest: string;
  validFrom: Date;
  validUntil: Date | null;
}>;

export type ReviewBinding = Readonly<{
  candidateDigest: string;
  evaluationRunId: string;
  baselineRevision: number;
  policyVersion: string;
}>;

export type NamespaceRevision = Readonly<{
  tenantId: string;
  namespaceId: string;
  revision: number;
}>;
