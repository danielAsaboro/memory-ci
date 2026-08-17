import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceRepository } from "./workspaces";

describe("WorkspaceRepository", () => {
  it("binds idempotency lookups to the transaction tenant", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new WorkspaceRepository({
      tenantId: "tenant-1",
      client: { query } as unknown as PoolClient,
    });

    await repository.getByIdempotencyKey("bootstrap-key-1");

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE tenant_id=\$1 AND idempotency_key=\$2/),
      ["tenant-1", "bootstrap-key-1"],
    );
  });
});
