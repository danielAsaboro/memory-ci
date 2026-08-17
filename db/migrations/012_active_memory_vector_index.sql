CREATE VECTOR INDEX IF NOT EXISTS memory_versions_active_embedding_idx
  ON memory_versions (tenant_id, namespace_id, active, embedding vector_cosine_ops);
