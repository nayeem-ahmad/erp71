import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "@erp71/shared-types";

/**
 * Standard error codes used across the system
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: "validation_error",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  DATABASE_ERROR: "database_error",
  INTERNAL_ERROR: "internal_server_error",
  UNKNOWN_ERROR: "unknown_error",
  TOO_MANY_REQUESTS: "too_many_requests",
};

/**
 * Type guard for ApiError structure
 */
function isApiError(obj: unknown): obj is ApiError {
  return (
    !!obj &&
    typeof obj === "object" &&
    "error" in obj &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!(obj as any).error &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (obj as any).error === "object" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "code" in (obj as any).error
  );
}

/**
 * Formats various error types into a standard ApiError
 */
export function formatError(error: unknown, requestId: string): ApiError {
  const timestamp = new Date().toISOString();

  // 1. Zod Validation Errors
  if (error instanceof ZodError) {
    return {
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Invalid request data",
        details: error.flatten().fieldErrors,
        timestamp,
        requestId,
        statusCode: 400,
      },
    };
  }

  // 2. Custom or Existing ApiError structures
  if (isApiError(error)) {
    return {
      error: {
        ...error.error,
        timestamp: error.error.timestamp || timestamp,
        requestId: error.error.requestId || requestId,
        statusCode: error.error.statusCode || 500,
      },
    };
  }

  // 3. PostgreSQL or Supabase Database Errors (simple detection)
  const dbError = error as { code?: string };
  if (dbError?.code && typeof dbError.code === 'string' && dbError.code.startsWith('P')) {
    return {
      error: {
        code: ERROR_CODES.DATABASE_ERROR,
        message: "A database error occurred",
        timestamp,
        requestId,
        statusCode: 500,
      },
    };
  }

  // 4. Default Fallback
  return {
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: error instanceof Error ? error.message : "An unexpected error occurred",
      timestamp,
      requestId,
      statusCode: 500,
    },
  };
}

/**
 * Higher-order function to wrap API route handlers with global error handling
 */
export function withErrorHandler(handler: (req: Request, ...args: unknown[]) => Promise<Response>) {
  return async (req: Request, ...args: unknown[]) => {
    const requestId = req.headers.get("x-request-id") || Math.random().toString(36).substring(7);
    
    try {
      return await handler(req, ...args);
    } catch (error) {
      console.error(`[API Error] Request ID: ${requestId}`, error);
      
      const apiError = formatError(error, requestId);
      const statusCode = apiError.error.statusCode || 500;
      
      // Clean up internal properties before sending response
      const responseBody = {
        error: {
          code: apiError.error.code,
          message: apiError.error.message,
          details: apiError.error.details,
          timestamp: apiError.error.timestamp,
          requestId: apiError.error.requestId,
        }
      };

      return NextResponse.json(responseBody, { 
        status: statusCode,
        headers: { "x-request-id": requestId }
      });
    }
  };
}

/**
 * Higher-order function to add caching headers to API responses.
 * Uses the Stale-While-Revalidate (SWR) pattern for optimal Edge performance.
 */
export function withCache(
  handler: (req: Request, ...args: unknown[]) => Promise<Response>,
  sMaxAge: number = 60,
  staleWhileRevalidate: number = 86400
) {
  return async (req: Request, ...args: unknown[]) => {
    const response = await handler(req, ...args);
    
    // Only cache successful GET requests
    if (req.method === 'GET' && response.status === 200) {
      // Create a new response to allow mutating headers
      const newResponse = new NextResponse(response.body, response);
      newResponse.headers.set(
        "Cache-Control",
        `public, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`
      );
      return newResponse;
    }
    
    return response;
  };
}
