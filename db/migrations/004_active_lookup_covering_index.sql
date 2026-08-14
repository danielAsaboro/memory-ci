CREATE INDEX IF NOT EXISTS memory_versions_active_lookup_idx
  ON memory_versions (tenant_id, namespace_id, memory_class, active)
  STORING (content_digest, canonical_payload, canonical_text, embedding)
  WHERE active;
