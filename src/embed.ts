import OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

const client = new OpenAI();

// Embed what defines the experience, not the user's instance details.
export function embeddingText(e: { title: string; description: string }): string {
  return `${e.title}. ${e.description}`;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  if (res.data.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${res.data.length}`);
  }
  return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
