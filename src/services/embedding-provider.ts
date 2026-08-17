import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

import { DomainError } from "../domain/errors";
import { embedSemanticText } from "./semantic-embedding";

export type EmbeddingProvider = Readonly<{ embed(text: string): Promise<string> }>;

export function createEmbeddingProvider(environment: Readonly<Record<string, string | undefined>> = process.env): EmbeddingProvider {
  if (environment.STASH_E2E === "1" || environment.NODE_ENV === "test") return { embed: async (text) => embedSemanticText(text) };
  const modelId = environment.BEDROCK_EMBEDDING_MODEL_ID;
  if (!modelId) throw new DomainError("provider_unavailable", "A managed Bedrock embedding model is required outside local E2E/test execution.");
  const client = new BedrockRuntimeClient({ region: environment.AWS_REGION });
  return { embed: async (text) => {
    try {
      const response = await client.send(new InvokeModelCommand({ modelId, contentType: "application/json", accept: "application/json", body: JSON.stringify({ inputText: text }) }));
      const body = JSON.parse(new TextDecoder().decode(response.body)) as { embedding?: unknown };
      if (!Array.isArray(body.embedding) || body.embedding.length !== 1024 || body.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("invalid_embedding_response");
      return `[${body.embedding.join(",")}]`;
    } catch { throw new DomainError("provider_unavailable", "Managed embedding generation is unavailable."); }
  } };
}
