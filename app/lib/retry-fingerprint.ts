function serialize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array:[${value.map(serialize).join(",")}]`;
  switch (typeof value) {
    case "string": return `string:${JSON.stringify(value)}`;
    case "number": return `number:${String(value)}`;
    case "boolean": return `boolean:${String(value)}`;
    case "undefined": return "undefined";
    case "object": return `object:{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${serialize(nested)}`)
      .join(",")}}`;
    default: throw new TypeError("Retry fingerprints support structured JSON values only.");
  }
}

export function retryFingerprint(value: unknown): string {
  return serialize(value);
}
