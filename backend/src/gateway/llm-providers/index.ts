// "Ask Marrow" LLM provider abstraction (2026-09-14). One interface, one
// working implementation for now (deepseek) -- `claude`/`codex` are valid
// `ai_provider_credentials.provider` values (095_ai_providers_and_chat.cjs)
// with no entry in PROVIDERS below; a lookup miss there is the natural
// "not wired up yet" signal for ai-chat.mixin.ts to surface as a clear
// error, not a crash. Adding a second working provider later is
// "implement LlmProvider, add one registry entry," not a redesign.
import { deepSeekProvider } from "./deepseek.js";

/** Injectable outbound HTTP client, mirroring git-credentials.ts's GitHttpFetch -- real `fetch` by default, a smoke test can fake it. */
export type LlmHttpFetch = typeof fetch;

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ChatMessage {
  role: ChatRole;
  /** null only for an assistant message that is pure tool_calls with no accompanying text. */
  content: string | null;
  /** Only meaningful on a role:"assistant" message that requested tool calls. */
  toolCalls?: LlmToolCall[];
  /** Only meaningful on a role:"tool" message -- which tool_call this is the result of. */
  toolCallId?: string;
}

export interface ToolSpecJson {
  name: string;
  description: string;
  parameters: unknown;
}

export interface LlmChatResult {
  content: string | null;
  toolCalls: LlmToolCall[];
}

export interface LlmProvider {
  chatCompletion(input: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    tools: ToolSpecJson[];
    httpFetch: LlmHttpFetch;
  }): Promise<LlmChatResult>;
  listModels(input: { apiKey: string; httpFetch: LlmHttpFetch }): Promise<string[]>;
}

export type ProviderId = "claude" | "codex" | "deepseek";

export const PROVIDERS: Partial<Record<ProviderId, LlmProvider>> = {
  deepseek: deepSeekProvider
};
