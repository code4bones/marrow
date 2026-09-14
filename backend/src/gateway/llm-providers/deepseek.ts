// DeepSeek client for the "Ask Marrow" chat loop (2026-09-14). DeepSeek's
// API is OpenAI-compatible (verified against api-docs.deepseek.com):
// POST /chat/completions with an OpenAI-shaped body/response (including
// function/tool_calls), and GET /models returning
// {object:"list", data:[{id,object,owned_by}]}. Mirrors
// git-credentials.ts's error-mapping shape (401/403 -> UNAUTHORIZED,
// network failure -> GATEWAY_ERROR) for a consistent error surface across
// every outbound-HTTP domain in this codebase.
import { AppError } from "../../shared/errors.js";
import type { ChatMessage, LlmChatResult, LlmHttpFetch, LlmProvider, LlmToolCall, ToolSpecJson } from "./index.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

// Minimal local alias -- avoids importing pg-tool-service/types.ts's Row
// into a provider-agnostic client module that has nothing else to do with
// the gateway's own request/response shapes.
type JsonRecord = Record<string, unknown>;

async function deepSeekRequest(
  path: string,
  apiKey: string,
  httpFetch: LlmHttpFetch,
  init?: { method: string; body?: unknown }
): Promise<Response> {
  let response: Response;
  try {
    response = await httpFetch(`${DEEPSEEK_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    });
  } catch (error) {
    throw new AppError(
      "GATEWAY_ERROR",
      `Could not reach DeepSeek: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "UNAUTHORIZED",
      `DeepSeek rejected the stored API key (HTTP ${response.status}). The key may be invalid or revoked -- add a fresh one in your profile.`
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new AppError("GATEWAY_ERROR", `DeepSeek returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
  }
  return response;
}

interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface DeepSeekMessage {
  role: string;
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
}

function toDeepSeekMessage(message: ChatMessage): DeepSeekMessage {
  if (message.role === "tool") {
    return { role: "tool", content: message.content ?? "", tool_call_id: message.toolCallId };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argumentsJson }
      }))
    };
  }
  return { role: message.role, content: message.content };
}

function toLlmToolCalls(toolCalls: DeepSeekToolCall[] | undefined): LlmToolCall[] {
  if (!toolCalls) {
    return [];
  }
  return toolCalls.map((tc) => ({ id: tc.id, name: tc.function.name, argumentsJson: tc.function.arguments }));
}

export const deepSeekProvider: LlmProvider = {
  async chatCompletion({ apiKey, model, messages, tools, httpFetch }): Promise<LlmChatResult> {
    const body: JsonRecord = {
      model,
      messages: messages.map(toDeepSeekMessage)
    };
    if (tools.length > 0) {
      body.tools = tools.map((tool: ToolSpecJson) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }));
    }
    const response = await deepSeekRequest("/chat/completions", apiKey, httpFetch, { method: "POST", body });
    const parsed = (await response.json()) as {
      choices?: Array<{ message?: DeepSeekMessage }>;
    };
    const message = parsed.choices?.[0]?.message;
    if (!message) {
      throw new AppError("GATEWAY_ERROR", "DeepSeek's chat completion response had no choices.");
    }
    return { content: message.content ?? null, toolCalls: toLlmToolCalls(message.tool_calls) };
  },

  async listModels({ apiKey, httpFetch }): Promise<string[]> {
    const response = await deepSeekRequest("/models", apiKey, httpFetch);
    const parsed = (await response.json()) as { data?: Array<{ id: string }> };
    return (parsed.data ?? []).map((model) => model.id);
  }
};
