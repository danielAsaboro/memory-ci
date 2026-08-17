import { createHash } from "node:crypto";

import { DomainError } from "../domain/errors";
import { canonicalJson } from "../services/provenance";
import type { TenantTransaction } from "./client";

type Row = { request_digest: string; receipt: unknown };

export class LifecycleReceiptRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  async replay<T extends Record<string, unknown>>(input: { operation: string; resourceId: string; idempotencyKey: string; request: unknown; execute(): Promise<T> }): Promise<T> {
    const digest = createHash("sha256").update(canonicalJson(input.request)).digest("hex");
    const found = await this.transaction.client.query<Row>(
      `SELECT request_digest,receipt FROM lifecycle_mutation_receipts
       WHERE tenant_id=$1 AND operation=$2 AND resource_id=$3 AND idempotency_key=$4`,
      [this.transaction.tenantId, input.operation, input.resourceId, input.idempotencyKey],
    );
    if (found.rows[0]) {
      if (found.rows[0].request_digest !== digest) throw new DomainError("conflict", "Idempotency key was already used for a different request.");
      return found.rows[0].receipt as T;
    }
    const receipt = input.execute();
    const resolved = await receipt;
    const inserted = await this.transaction.client.query<{ request_digest: string; receipt: unknown }>(
      `INSERT INTO lifecycle_mutation_receipts (tenant_id,operation,resource_id,idempotency_key,request_digest,receipt)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING request_digest,receipt`,
      [this.transaction.tenantId, input.operation, input.resourceId, input.idempotencyKey, digest, resolved],
    );
    if (inserted.rows[0]) return resolved;
    const concurrent = await this.transaction.client.query<Row>(
      `SELECT request_digest,receipt FROM lifecycle_mutation_receipts
       WHERE tenant_id=$1 AND operation=$2 AND resource_id=$3 AND idempotency_key=$4`,
      [this.transaction.tenantId, input.operation, input.resourceId, input.idempotencyKey],
    );
    if (!concurrent.rows[0] || concurrent.rows[0].request_digest !== digest) throw new DomainError("conflict", "Idempotency key was already used for a different request.");
    return concurrent.rows[0].receipt as T;
  }
}
