import type { ApiErrorBody } from "@refract/shared";
import { publicConfig } from "./config";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Call the API from the browser with the session cookie. Throws ApiRequestError on non-2xx. */
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${publicConfig.apiUrl}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiRequestError(
      0,
      "network",
      "Couldn't reach the server. Check your connection and try again.",
    );
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      json?.error?.code ?? `http_${res.status}`,
      json?.error?.message ?? "Something went wrong. Try again.",
    );
  }
  return json as T;
}
