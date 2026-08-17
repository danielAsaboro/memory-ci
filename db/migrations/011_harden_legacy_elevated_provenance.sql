UPDATE sources
SET signature_verified=false, trust_class='observed'
WHERE trust_class IN ('authenticated','authoritative')
  AND (signature_identity IS NULL OR signature_key_id IS NULL OR signature_key_fingerprint IS NULL
       OR signature_public_key IS NULL OR signature_registry_version IS NULL OR signature_algorithm <> 'ed25519'
       OR signature IS NULL OR canonical_signed_payload IS NULL OR signature_payload_version IS NULL);

UPDATE memory_candidates AS candidate
SET trust_class='observed'
FROM sources AS source
WHERE candidate.tenant_id=source.tenant_id AND candidate.source_id=source.id
  AND candidate.trust_class IN ('authenticated','authoritative')
  AND (source.trust_class NOT IN ('authenticated','authoritative') OR source.signature_verified=false
       OR source.signature_identity IS NULL OR source.signature_key_id IS NULL OR source.signature_key_fingerprint IS NULL
       OR source.signature_public_key IS NULL OR source.signature_registry_version IS NULL
       OR source.signature_algorithm <> 'ed25519' OR source.signature IS NULL
       OR source.canonical_signed_payload IS NULL OR source.signature_payload_version IS NULL);
