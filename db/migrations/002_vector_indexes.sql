CREATE VECTOR INDEX IF NOT EXISTS memory_candidates_embedding_idx
  ON memory_candidates (tenant_id, namespace_id, memory_class, embedding vector_cosine_ops);

CREATE VECTOR INDEX IF NOT EXISTS memory_versions_embedding_idx
  ON memory_versions (tenant_id, namespace_id, memory_class, embedding vector_cosine_ops);

CREATE VECTOR INDEX IF NOT EXISTS evaluation_scenarios_embedding_idx
  ON evaluation_scenarios (tenant_id, namespace_id, embedding vector_cosine_ops);
