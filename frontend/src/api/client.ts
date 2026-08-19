// Single network boundary. A future iOS/React Native port only swaps BASE_URL.
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  /** Server-assigned id for this failure; quoting it in the toast makes a user
   * report findable in the logs. */
  requestId?: string;
  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE_URL}/api/v1${path}`, {
    // JSON header only for string bodies; FormData sets its own boundary
    headers: typeof init?.body === "string" ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    let requestId = resp.headers.get("X-Request-ID") ?? undefined;
    try {
      const body = await resp.json();
      message = body?.error?.message ?? body?.detail ?? message;
      requestId = body?.error?.request_id ?? requestId;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(resp.status, message, requestId);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
