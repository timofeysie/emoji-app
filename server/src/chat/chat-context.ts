import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

/**
 * How much of the model's context a chat uses (docs/hashbrown/creating-games-with-hashbrown.md
 * → Context indicator). Hashbrown's OpenAI adapter drops OpenAI's own usage
 * figures, so we count with `o200k_base` (gpt-4.1, gpt-4o): an estimate.
 */

/** `/api/chat` body limit (main.ts). The whole history is resent each turn. */
export const CHAT_BODY_LIMIT_BYTES = 1024 * 1024;

/** Context windows in tokens. Unknown models report no window. */
export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
};

/** OpenAI's chat format: a few tokens per message, and 3 to prime the reply. */
const TOKENS_PER_MESSAGE = 3;
const REPLY_PRIMING_TOKENS = 3;
/** What a `response_format` costs beyond its schema (measured against gpt-4.1, 2026-11-21). */
const RESPONSE_FORMAT_OVERHEAD = 8;

/** The parts of an OpenAI chat completion request that take up context. */
export type OpenAiChatRequest = {
  model?: string;
  messages?: ReadonlyArray<{
    role?: string;
    content?: unknown;
    tool_calls?: ReadonlyArray<{ function?: { name?: string; arguments?: unknown } }>;
  }>;
  tools?: unknown;
  response_format?: unknown;
};

export type RequestTokenCount = {
  /** System prompt, tool definitions and response schema. */
  fixedTokens: number;
  /** Every other message, tool calls and results included. */
  messageTokens: number;
};

function asText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function count(value: unknown): number {
  const text = asText(value);
  return text.length === 0 ? 0 : countTokens(text);
}

type JsonSchema = {
  type?: unknown;
  description?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

/** A JSON schema as the TypeScript-like type OpenAI shows the model for tools. */
function schemaAsType(schema: JsonSchema | undefined): string {
  if (!schema || typeof schema !== 'object') return 'any';
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(schemaAsType).join(' | ');
  if (schema.type === 'array') return `${schemaAsType(schema.items)}[]`;
  if (schema.type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? []);
    const lines = Object.entries(schema.properties ?? {}).map(
      ([key, value]) =>
        `${value?.description ? `// ${value.description}\n` : ''}${key}${required.has(key) ? '' : '?'}: ${schemaAsType(value)},`,
    );
    return `{\n${lines.join('\n')}\n}`;
  }
  if (schema.type === 'integer') return 'number';
  return typeof schema.type === 'string' ? schema.type : 'any';
}

type ToolDefinition = { function?: { name?: string; description?: string; parameters?: JsonSchema } };

/**
 * Tools cost what OpenAI renders them as (a `namespace functions` of types),
 * not their JSON, which is up to twice as long. Within about 3% when measured.
 */
function countTools(tools: unknown): number {
  if (!Array.isArray(tools) || tools.length === 0) return 0;
  const body = (tools as ToolDefinition[])
    .map(({ function: fn }) =>
      `${fn?.description ? `// ${fn.description}\n` : ''}type ${fn?.name ?? ''} = (_: ${schemaAsType(fn?.parameters)}) => any;`,
    )
    .join('\n\n');
  return countTokens(`# Tools\n\n## functions\n\nnamespace functions {\n\n${body}\n\n} // namespace functions`);
}

/**
 * A response schema costs about its JSON without `additionalProperties` and
 * `required` (within about 5% for chat-sized schemas, when measured).
 */
function countResponseFormat(responseFormat: unknown): number {
  if (!responseFormat) return 0;
  const schema = (responseFormat as { json_schema?: { schema?: unknown } }).json_schema?.schema;
  if (!schema) return count(responseFormat);
  const text = JSON.stringify(schema, (key, value) => (key === 'additionalProperties' || key === 'required' ? undefined : value));
  return countTokens(text) + RESPONSE_FORMAT_OVERHEAD;
}

/** Pure: the tokens a request sends. */
export function countRequestTokens(request: OpenAiChatRequest): RequestTokenCount {
  let fixedTokens = countTools(request.tools) + countResponseFormat(request.response_format) + REPLY_PRIMING_TOKENS;
  let messageTokens = 0;
  for (const message of request.messages ?? []) {
    let tokens = TOKENS_PER_MESSAGE + count(message.content);
    for (const call of message.tool_calls ?? []) {
      tokens += count(call.function?.name) + count(call.function?.arguments);
    }
    if (message.role === 'system') {
      fixedTokens += tokens;
    } else {
      messageTokens += tokens;
    }
  }
  return { fixedTokens, messageTokens };
}

/** The parts of a Hashbrown `generation-chunk` frame that the reply adds. */
type GenerationChunkFrame = {
  type: 'generation-chunk';
  chunk?: {
    choices?: ReadonlyArray<{
      delta?: {
        content?: string | null;
        toolCalls?: ReadonlyArray<{ function?: { name?: string; arguments?: string } }> | null;
      };
    }>;
  };
};

/** Pure: the reply text one frame adds (content, tool names and arguments). */
export function replyTextOfFrame(frame: unknown): string {
  if (!frame || typeof frame !== 'object' || (frame as { type?: unknown }).type !== 'generation-chunk') {
    return '';
  }
  let text = '';
  for (const choice of (frame as GenerationChunkFrame).chunk?.choices ?? []) {
    text += choice.delta?.content ?? '';
    for (const call of choice.delta?.toolCalls ?? []) {
      text += (call.function?.name ?? '') + (call.function?.arguments ?? '');
    }
  }
  return text;
}

/**
 * Reads Hashbrown frames (`[4-byte BE length][UTF-8 JSON]`, core's
 * `encodeFrame`) from the bytes the chat streams, whatever the chunking.
 */
export class FrameReader {
  private buffer = new Uint8Array(0);
  private readonly decoder = new TextDecoder();

  push(bytes: Uint8Array): unknown[] {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer);
    joined.set(bytes, this.buffer.length);

    const frames: unknown[] = [];
    let offset = 0;
    while (joined.length - offset >= 4) {
      const length = new DataView(joined.buffer, joined.byteOffset + offset, 4).getUint32(0, false);
      if (joined.length - offset - 4 < length) {
        break;
      }
      const json = this.decoder.decode(joined.subarray(offset + 4, offset + 4 + length));
      try {
        frames.push(JSON.parse(json));
      } catch {
        // Not a frame we can read; the count just misses it.
      }
      offset += 4 + length;
    }
    this.buffer = joined.slice(offset);
    return frames;
  }
}

/** Counts a reply as it streams. */
export class ReplyTokenCounter {
  private readonly reader = new FrameReader();
  private text = '';

  push(bytes: Uint8Array): void {
    for (const frame of this.reader.push(bytes)) {
      this.text += replyTextOfFrame(frame);
    }
  }

  get tokens(): number {
    return count(this.text);
  }
}
