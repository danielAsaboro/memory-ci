import { DomainError } from "../domain/errors";

const prohibitedKeys = /^(api[_-]?key|access[_-]?token|password|passwd|private[_-]?key|secret|credential)$/i;
const executableKeys = /^(command|shell|script|executable|code)$/i;
const executableContent = /(?:\bcurl\b|\bwget\b).*(?:\|\s*(?:sh|bash)\b)|(?:^|\s)(?:rm\s+-rf|sudo\s+|chmod\s+\+x)/i;

const prosePatterns: Array<{ id: string; pattern: RegExp }> = [
  { id: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { id: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

function inspectStructuredValue(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectStructuredValue(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (prohibitedKeys.test(key)) {
      throw new DomainError("invalid_input", `Secret-bearing field is not allowed at ${[...path, key].join(".")}.`);
    }
    if (executableKeys.test(key) || (typeof nested === "string" && executableContent.test(nested))) {
      throw new DomainError("invalid_input", `Executable memory payload is not allowed at ${[...path, key].join(".")}.`);
    }
    inspectStructuredValue(nested, [...path, key]);
  }
}

export function redactCandidatePayload(input: {
  payload: Readonly<Record<string, unknown>>;
  canonicalText: string;
}): { payload: Readonly<Record<string, unknown>>; canonicalText: string; redactions: string[] } {
  inspectStructuredValue(input.payload);
  let canonicalText = input.canonicalText;
  const redactions: string[] = [];
  for (const { id, pattern } of prosePatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(canonicalText)) {
      redactions.push(id);
      pattern.lastIndex = 0;
      canonicalText = canonicalText.replace(pattern, `[REDACTED:${id}]`);
    }
  }
  return { payload: input.payload, canonicalText, redactions };
}
