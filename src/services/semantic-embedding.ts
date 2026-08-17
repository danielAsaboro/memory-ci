import { createHash } from "node:crypto";

const dimensions = 1024;

/** Server-side lexical semantic embedding: shared meaningful terms map to the same normalized vector dimensions. */
export function embedSemanticText(text: string): string {
  const values = new Float64Array(dimensions);
  for (const token of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) {
    const hash = createHash("sha256").update(token).digest();
    const index = hash.readUInt16BE(0) % dimensions;
    values[index] += hash[2]! % 2 ? 1 : -1;
  }
  const magnitude = Math.hypot(...values) || 1;
  return `[${[...values].map((value) => (value / magnitude).toFixed(8)).join(",")}]`;
}
