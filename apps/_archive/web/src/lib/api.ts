import { createClient } from "./supabase";
import { ApiError } from "@erp71/shared-types";

/**
 * Custom error class for API errors
 */
export class ApiRequestError extends Error {
  apiError: ApiError;
  statusCode: number;

  constructor(apiError: ApiError, statusCode: number) {
    super(apiError.error.message);
    this.apiError = apiError;
    this.statusCode = statusCode;
    this.name = "ApiRequestError";
  }
}

/**
 * Standardized API client for making fetch requests
 */
export const apiClient = {
  async get<T>(path: string, options?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  },

  async post<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async put<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  async delete<T>(path: string, options?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  },

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    
    const headers = new Headers(options.headers);
    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`);
    }
    
    if (!headers.has("Content-Type") && options.body) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`/api${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: {
          code: "unknown_error",
          message: "An unexpected error occurred",
          timestamp: new Date().toISOString(),
          requestId: response.headers.get("x-request-id") || "unknown",
        },
      }));
      
      throw new ApiRequestError(errorData, response.status);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  },
};
