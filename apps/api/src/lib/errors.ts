/** Error with an HTTP status and a stable machine-readable code, rendered in OpenAI error shape. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

export function errorBody(status: number, code: string, message: string) {
  return { error: { message, type: errorType(status), code } };
}
