import { createHash } from "node:crypto";

const dimensions = 1024;

/** Local E2E/test-only embedding adapter. Production always uses the managed Bedrock provider. */
const synonymRoots: Record<string, string> = {
  refunds: "refund", reimbursement: "refund", reimbursements: "refund", return: "refund", returns: "refund",
  human: "review", manual: "review", staff: "review", person: "review", authorization: "review", approve: "review", approval: "review",
  above: "threshold", over: "threshold", greater: "threshold", exceeds: "threshold",
};

export function embedSemanticText(text: string): string {
  const values = new Float64Array(dimensions);
  for (const original of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) {
    const token = synonymRoots[original] ?? original;
    const hash = createHash("sha256").update(token).digest();
    const index = hash.readUInt16BE(0) % dimensions;
    values[index] += hash[2]! % 2 ? 1 : -1;
  }
  const magnitude = Math.hypot(...values) || 1;
  return `[${[...values].map((value) => (value / magnitude).toFixed(8)).join(",")}]`;
}
