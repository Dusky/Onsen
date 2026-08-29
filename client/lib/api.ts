import type { ApiError } from "@shared/types.ts";

/**
 * The client never talks to an inference backend (SPEC §0.7) — every request
 * goes to this app's own API on the same origin, so there is no CORS and no
 * base URL to configure.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | undefined;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiRequestError(0, "network", "Could not reach the server.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const error = (body as ApiError | null)?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? "unexpected",
      error?.message ?? "Something went wrong.",
      error?.retryAfter,
    );
  }

  return body as T;
}

function withBody(method: string, body: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, withBody("POST", body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, withBody("PUT", body)),
  patch: <T>(path: string, body?: unknown) => request<T>(path, withBody("PATCH", body)),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
