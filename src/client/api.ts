export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "ApiError"; }
}
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null): void { csrfToken = token; }

async function refreshCsrf(): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/csrf", { credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json() as { csrfToken?: string };
    csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : null;
    return csrfToken;
  } catch { return null; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!(["GET", "HEAD", "OPTIONS"].includes(method)) && !headers.has("X-CSRF-Token")) {
    const token = csrfToken ?? await refreshCsrf();
    if (token) headers.set("X-CSRF-Token", token);
  }
  const response = await fetch(path, { ...init, method, headers, credentials: "include", redirect: "follow" });
  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new ApiError("The server returned an unreadable response.", response.status); }
  }
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "The request could not be completed.";
    const code = typeof data === "object" && data !== null && "code" in data && typeof data.code === "string" ? data.code : undefined;
    if (response.status === 403 && code === "CSRF_TOKEN_INVALID") csrfToken = null;
    throw new ApiError(message, response.status, code);
  }
  return data as T;
}
