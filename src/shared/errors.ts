export type ErrorCode =
  | "CURRENT_PROJECT_NOT_SET"
  | "DB_ERROR"
  | "DECISION_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "TASK_NOT_FOUND"
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

  if (error instanceof Error) {
    return new AppError("DB_ERROR", error.message);
  }

  return new AppError("DB_ERROR", "Unexpected error.");
}
