"use client";

/** A stable id for this browser tab. The SSE stream skips our own echoes. */
export const CLIENT_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, payload?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-ushabti-client": CLIENT_ID,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep the default message */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, payload?: unknown) => request<T>("POST", url, payload ?? {}),
  put: <T>(url: string, payload?: unknown) => request<T>("PUT", url, payload ?? {}),
  patch: <T>(url: string, payload?: unknown) => request<T>("PATCH", url, payload ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};
