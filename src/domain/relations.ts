export const relationTypes = ["contradicts", "corroborates", "depends_on", "refines", "supersedes"] as const;
export type RelationType = (typeof relationTypes)[number];

export type RelationEvidence = Readonly<{
  relationType: RelationType;
  confidence: number;
  evidence: Readonly<Record<string, unknown>>;
}>;
