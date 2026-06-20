import { ZodError } from "zod/v4";

export type ErrorCode =
  | "ARTIFACT_CONFLICT"
  | "CURRENT_PROJECT_NOT_SET"
  | "ARTIFACT_NOT_FOUND"
  | "DB_ERROR"
  | "DECISION_NOT_FOUND"
  | "GATEWAY_ERROR"
  | "ITEM_NOT_FOUND"
  | "LINK_NOT_FOUND"
  | "NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AppError("VALIDATION_ERROR", "Tool input validation failed.", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  if (error instanceof Error) {
    return new AppError("DB_ERROR", error.message);
  }

  return new AppError("DB_ERROR", "Unexpected error.");
}
