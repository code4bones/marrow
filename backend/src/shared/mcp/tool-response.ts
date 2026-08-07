import { AppError, toAppError } from "../errors.js";

export interface ToolSuccess<T> {
  ok: true;
  summary: string;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ToolResponse<T> = ToolSuccess<T> | ToolFailure;

export function ok<T>(summary: string, data: T): ToolSuccess<T> {
  return { ok: true, summary, data };
}

export function fail(error: unknown): ToolFailure {
  const appError: AppError = toAppError(error);
  return {
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details
    }
  };
}

export function asMcpResult<T>(response: ToolResponse<T>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2)
      }
    ],
    structuredContent: response as unknown as Record<string, unknown>
  };
}
