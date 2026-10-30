import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ReasoningEffort } from "openai/resources/shared";
import type { z } from "zod";

const anthropic = new Anthropic();
const openai = new OpenAI();

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Which model runs a structured-output call. OpenAI reasoning is null for non-reasoning models.
export type LlmConfig =
  | { provider: "anthropic"; model: "claude-opus-5-5" | "claude-haiku-5-5"; effort: Effort }
  | { provider: "openai"; model: string; reasoning: ReasoningEffort | null };

// Streams a structured-output call's JSON text as it's generated, so callers can act on
// pieces before the whole response finishes. Throws on refusal, truncation or failure.
export async function* streamStructuredText(opts: {
  config: LlmConfig;
  system: string;
  user: string;
  schema: z.ZodType;
}): AsyncGenerator<string> {
  if (opts.config.provider === "anthropic") yield* streamAnthropic({ ...opts, config: opts.config });
  else yield* streamOpenAI({ ...opts, config: opts.config });
}

async function* streamAnthropic(opts: {
  config: Extract<LlmConfig, { provider: "anthropic" }>;
  system: string;
  user: string;
  schema: z.ZodType;
}): AsyncGenerator<string> {
  const stream = anthropic.messages.stream({
    model: opts.config.model,
    max_tokens: 16000,
    output_config: { effort: opts.config.effort, format: zodOutputFormat(opts.schema) },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error(`Model refused: ${JSON.stringify(final.stop_details)}`);
  if (final.stop_reason !== "end_turn") throw new Error(`Unexpected stop_reason: ${final.stop_reason}`);
}

async function* streamOpenAI(opts: {
  config: Extract<LlmConfig, { provider: "openai" }>;
  system: string;
  user: string;
  schema: z.ZodType;
}): AsyncGenerator<string> {
  const stream = await openai.responses.create({
    model: opts.config.model,
    stream: true,
    instructions: opts.system,
    input: opts.user,
    text: { format: zodTextFormat(opts.schema, "result") },
    ...(opts.config.reasoning === null ? {} : { reasoning: { effort: opts.config.reasoning } }),
  });

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta":
        yield event.delta;
        break;
      case "response.refusal.done":
        throw new Error(`Model refused: ${event.refusal}`);
      case "response.incomplete":
        throw new Error(`Response incomplete: ${JSON.stringify(event.response.incomplete_details)}`);
      case "response.failed":
        throw new Error(`Response failed: ${JSON.stringify(event.response.error)}`);
      case "error":
        throw new Error(`OpenAI stream error: ${event.message}`);
    }
  }
}

// Pulls complete objects out of a streamed `{"key": [ {...}, {...} ]}` document as soon as each closes.
export class ArrayItemParser {
  private buffer = "";
  private depth = 0;
  private inString = false;
  private escaped = false;
  private itemStart = -1;
  private scanned = 0;

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const items: unknown[] = [];
    for (; this.scanned < this.buffer.length; this.scanned++) {
      const ch = this.buffer[this.scanned];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === '"') this.inString = true;
      else if (ch === "{") {
        this.depth++;
        // Depth 1 is the wrapper object; depth 2 is an item of its array.
        if (this.depth === 2) this.itemStart = this.scanned;
      } else if (ch === "}") {
        if (this.depth === 2) items.push(JSON.parse(this.buffer.slice(this.itemStart, this.scanned + 1)));
        this.depth--;
      }
    }
    return items;
  }
}
