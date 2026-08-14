import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { withTenantTransaction } from "./client";

function retryingPool() {
  const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool, client };
}

describe("CockroachDB transaction retries", () => {
  it("retries serialization failures with bounded exponential backoff and jitter", async () => {
    const { pool, client } = retryingPool();
    const delays: number[] = [];
    let attempts = 0;
    const result = await withTenantTransaction(pool, "tenant-1", async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("retry"), { code: "40001" });
      return "committed";
    }, 5, { baseDelayMs: 10, maxDelayMs: 100, random: () => 0.5, sleep: async (delay) => { delays.push(delay); } });

    expect(result).toBe("committed");
    expect(delays).toEqual([15, 25]);
    expect(client.release).toHaveBeenCalledTimes(3);
  });

  it("does not blindly retry an ambiguous commit", async () => {
    const { pool } = retryingPool();
    let attempts = 0;
    await expect(withTenantTransaction(pool, "tenant-1", async () => {
      attempts += 1;
      throw Object.assign(new Error("ambiguous"), { code: "40003" });
    })).rejects.toMatchObject({ code: "40003" });
    expect(attempts).toBe(1);
  });
});
